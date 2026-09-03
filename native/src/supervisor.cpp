#include "supervisor.h"

#include "build_config.h"
#include "runtime_config.h"

#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <memory>
#include <mutex>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace sam31::supervisor {
namespace {

using Clock = std::chrono::steady_clock;

struct WsaSession {
    WsaSession() {
        WSADATA data{};
        if (WSAStartup(MAKEWORD(2, 2), &data) != 0) throw std::runtime_error("WSAStartup failed.");
    }
    ~WsaSession() { WSACleanup(); }
};

struct SocketHandle {
    SOCKET value = INVALID_SOCKET;
    explicit SocketHandle(SOCKET socket = INVALID_SOCKET) : value(socket) {}
    ~SocketHandle() {
        if (value != INVALID_SOCKET) closesocket(value);
    }
    SocketHandle(const SocketHandle&) = delete;
    SocketHandle& operator=(const SocketHandle&) = delete;
};

struct BackendProcess {
    HANDLE process = nullptr;
    HANDLE thread = nullptr;
    HANDLE job = nullptr;
    DWORD pid = 0;
    std::uint16_t port = 0;
    std::string token;
    std::filesystem::path sessionRoot;

    ~BackendProcess() { close(); }

    void close() {
        if (thread) CloseHandle(thread);
        if (process) CloseHandle(process);
        if (job) CloseHandle(job);
        thread = nullptr;
        process = nullptr;
        job = nullptr;
        pid = 0;
        port = 0;
        token.clear();
        sessionRoot.clear();
    }

    bool alive() const {
        return process && WaitForSingleObject(process, 0) == WAIT_TIMEOUT;
    }
};

std::wstring quoteArgument(std::wstring_view value) {
    if (value.empty()) return L"\"\"";
    if (value.find_first_of(L" \t\n\v\"") == std::wstring_view::npos) return std::wstring(value);
    std::wstring result = L"\"";
    std::size_t slashes = 0;
    for (const wchar_t ch : value) {
        if (ch == L'\\') {
            ++slashes;
        } else if (ch == L'\"') {
            result.append(slashes * 2 + 1, L'\\');
            result.push_back(L'\"');
            slashes = 0;
        } else {
            result.append(slashes, L'\\');
            slashes = 0;
            result.push_back(ch);
        }
    }
    result.append(slashes * 2, L'\\');
    result.push_back(L'\"');
    return result;
}

std::wstring widen(std::string_view value) {
    if (value.empty()) return {};
    const int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                                           static_cast<int>(value.size()), nullptr, 0);
    if (length <= 0) throw std::runtime_error("Invalid UTF-8 path from UXP.");
    std::wstring result(static_cast<std::size_t>(length), L'\0');
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()),
                            result.data(), length) != length) {
        throw std::runtime_error("Unable to convert UXP path to UTF-16.");
    }
    return result;
}

std::string randomToken() {
    std::array<unsigned char, 32> bytes{};
    if (BCryptGenRandom(nullptr, bytes.data(), static_cast<ULONG>(bytes.size()),
                        BCRYPT_USE_SYSTEM_PREFERRED_RNG) != 0) {
        throw std::runtime_error("Unable to create backend authentication token.");
    }
    std::ostringstream output;
    output << std::hex << std::setfill('0');
    for (const auto byte : bytes) output << std::setw(2) << static_cast<unsigned int>(byte);
    return output.str();
}

std::string extractJsonString(std::string_view json, std::string_view field) {
    const std::string needle = "\"" + std::string(field) + "\"";
    const auto name = json.find(needle);
    if (name == std::string_view::npos) return {};
    const auto colon = json.find(':', name + needle.size());
    if (colon == std::string_view::npos) return {};
    const auto start = json.find('"', colon + 1);
    if (start == std::string_view::npos) return {};
    const auto end = json.find('"', start + 1);
    if (end == std::string_view::npos) return {};
    return std::string(json.substr(start + 1, end - start - 1));
}

std::optional<unsigned long> extractJsonUnsigned(std::string_view json, std::string_view field) {
    const std::string needle = "\"" + std::string(field) + "\"";
    const auto name = json.find(needle);
    if (name == std::string_view::npos) return std::nullopt;
    const auto colon = json.find(':', name + needle.size());
    if (colon == std::string_view::npos) return std::nullopt;
    auto begin = colon + 1;
    while (begin < json.size() && std::isspace(static_cast<unsigned char>(json[begin]))) ++begin;
    auto end = begin;
    while (end < json.size() && std::isdigit(static_cast<unsigned char>(json[end]))) ++end;
    if (end == begin) return std::nullopt;
    try {
        return std::stoul(std::string(json.substr(begin, end - begin)));
    } catch (...) {
        return std::nullopt;
    }
}

bool looksLikeJsonObject(std::string_view value) {
    auto first = std::find_if_not(value.begin(), value.end(),
                                  [](unsigned char ch) { return std::isspace(ch) != 0; });
    auto last = std::find_if_not(value.rbegin(), value.rend(),
                                 [](unsigned char ch) { return std::isspace(ch) != 0; });
    return first != value.end() && last != value.rend() && *first == '{' && *last == '}';
}

bool sendAll(SOCKET socket, std::string_view data) {
    std::size_t offset = 0;
    while (offset < data.size()) {
        const int count = send(socket, data.data() + offset,
                               static_cast<int>(std::min<std::size_t>(data.size() - offset, 1U << 20)), 0);
        if (count <= 0) return false;
        offset += static_cast<std::size_t>(count);
    }
    return true;
}

struct HttpResult {
    bool connected = false;
    int status = 0;
    std::string body;
};

HttpResult httpCall(std::uint16_t port, std::string_view token, std::string_view method,
                    std::string_view path, std::string_view body, int timeoutMilliseconds) {
    SocketHandle socket(::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
    if (socket.value == INVALID_SOCKET) return {};
    DWORD timeout = static_cast<DWORD>(timeoutMilliseconds);
    setsockopt(socket.value, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&timeout), sizeof(timeout));
    setsockopt(socket.value, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char*>(&timeout), sizeof(timeout));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(port);
    if (connect(socket.value, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR) return {};

    std::ostringstream request;
    request << method << ' ' << path << " HTTP/1.1\r\n"
            << "Host: 127.0.0.1\r\n"
            << "Authorization: Bearer " << token << "\r\n"
            << "Content-Type: application/json; charset=utf-8\r\n"
            << "Content-Length: " << body.size() << "\r\n"
            << "Connection: close\r\n\r\n"
            << body;
    if (!sendAll(socket.value, request.str())) return {true, 0, {}};

    std::string response;
    std::array<char, 16384> buffer{};
    while (response.size() <= 2U * 1024U * 1024U) {
        const int count = recv(socket.value, buffer.data(), static_cast<int>(buffer.size()), 0);
        if (count == 0) break;
        if (count < 0) return {true, 0, {}};
        response.append(buffer.data(), static_cast<std::size_t>(count));
    }
    if (response.size() > 2U * 1024U * 1024U) return {true, 0, {}};

    const auto firstSpace = response.find(' ');
    int status = 0;
    if (firstSpace != std::string::npos && response.size() >= firstSpace + 4) {
        status = std::atoi(response.substr(firstSpace + 1, 3).c_str());
    }
    const auto separator = response.find("\r\n\r\n");
    if (separator == std::string::npos) return {true, status, {}};
    return {true, status, response.substr(separator + 4)};
}

void writeTokenFile(const std::filesystem::path& path, std::string_view token) {
    const HANDLE file = CreateFileW(path.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW,
                                    FILE_ATTRIBUTE_TEMPORARY | FILE_ATTRIBUTE_NOT_CONTENT_INDEXED, nullptr);
    if (file == INVALID_HANDLE_VALUE) throw std::runtime_error("Unable to create backend token file.");
    DWORD written = 0;
    const BOOL ok = WriteFile(file, token.data(), static_cast<DWORD>(token.size()), &written, nullptr);
    const BOOL flushed = FlushFileBuffers(file);
    CloseHandle(file);
    if (!ok || !flushed || written != token.size()) {
        std::error_code ignored;
        std::filesystem::remove(path, ignored);
        throw std::runtime_error("Unable to write backend token file.");
    }
}

}  // namespace

class Engine::Impl {
 public:
    Impl() : wsa_(std::make_unique<WsaSession>()) {}
    ~Impl() { shutdown(); }

    std::string infer(std::string_view rootText, std::string_view requestJson) {
        if (rootText.empty() || requestJson.empty() || requestJson.size() > 1024U * 1024U) {
            throw std::runtime_error("Native inference arguments are invalid.");
        }
        const std::string requestId = extractJsonString(requestJson, "requestId");
        if (requestId.empty()) throw std::runtime_error("Inference requestId is missing.");

        std::lock_guard inferenceLock(inferenceMutex_);
        {
            std::lock_guard stateLock(stateMutex_);
            activeRequestId_ = requestId;
            cancelRequested_.store(false);
        }
        struct ActiveGuard {
            Impl& owner;
            ~ActiveGuard() {
                std::lock_guard lock(owner.stateMutex_);
                owner.activeRequestId_.clear();
                owner.cancelRequested_.store(false);
            }
        } guard{*this};

        const std::filesystem::path sessionRoot = std::filesystem::absolute(std::filesystem::path(widen(rootText)));
        if (!std::filesystem::is_directory(sessionRoot)) {
            throw std::runtime_error("UXP session root does not exist.");
        }

        for (int attempt = 0; attempt < 2; ++attempt) {
            if (cancelRequested_.load()) throw CancelledError("Inference was cancelled.");
            const auto endpoint = ensureBackend(sessionRoot);
            const HttpResult result = httpCall(endpoint.port, endpoint.token, "POST", "/v1/infer",
                                               requestJson, 10 * 60 * 1000);
            if (cancelRequested_.load()) throw CancelledError("Inference was cancelled.");

            const bool validBody = looksLikeJsonObject(result.body);
            if (result.status >= 200 && result.status < 500 && validBody) return result.body;
            if (attempt == 0 && (!result.connected || result.status == 0 || result.status >= 500 || !validBody)) {
                stopBackend();
                continue;
            }
            if (result.status >= 500 && validBody) return result.body;
            throw std::runtime_error("Backend transport or protocol failed after one retry.");
        }
        throw std::runtime_error("Backend inference failed after one retry.");
    }

    bool cancel(std::string_view requestId) {
        {
            std::lock_guard lock(stateMutex_);
            if (activeRequestId_.empty() || activeRequestId_ != requestId) return false;
            cancelRequested_.store(true);
        }
        stopBackend();
        return true;
    }

    void shutdown() {
        shuttingDown_.store(true);
        cancelRequested_.store(true);
        stopBackend();
    }

 private:
    struct Endpoint {
        std::uint16_t port;
        std::string token;
    };

    Endpoint ensureBackend(const std::filesystem::path& sessionRoot) {
        std::lock_guard lock(processMutex_);
        if (shuttingDown_.load()) throw std::runtime_error("Native bridge is shutting down.");
        if (backend_ && backend_->alive() && backend_->sessionRoot == sessionRoot) {
            const auto health = httpCall(backend_->port, backend_->token, "GET", "/v1/health", {}, 2500);
            if (health.status == 200 && looksLikeJsonObject(health.body)) {
                return {backend_->port, backend_->token};
            }
            terminateLocked();
        } else if (backend_) {
            terminateLocked();
        }
        startLocked(sessionRoot);
        return {backend_->port, backend_->token};
    }

    void startLocked(const std::filesystem::path& sessionRoot) {
        const auto runtime = loadRuntimeConfig();
        const auto& python = runtime.python;
        const auto& backendRoot = runtime.backendRoot;
        const auto token = randomToken();
        const auto nonce = std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64());
        const std::wstring tokenName = L"backend-token-" + nonce + L".txt";
        const std::wstring readyName = L"backend-ready-" + nonce + L".json";
        const auto tokenPath = sessionRoot / tokenName;
        const auto readyPath = sessionRoot / readyName;
        std::error_code ignored;
        std::filesystem::remove(readyPath, ignored);
        writeTokenFile(tokenPath, token);

        std::vector<std::wstring> args = {
            python.wstring(), L"-m", L"sam31_backend.server", L"--port", L"0",
            L"--session-root", sessionRoot.wstring(), L"--token-file", tokenPath.wstring(),
            L"--ready-file", readyName, L"--parent-pid", std::to_wstring(GetCurrentProcessId()),
            L"--idle-seconds", L"120"
        };
#if SAM31_BACKEND_MOCK_ALPHA
        args.push_back(L"--mock-alpha");
#else
        args.push_back(L"--model-checkpoint");
        args.push_back(runtime.modelCheckpoint.wstring());
        args.push_back(L"--official-sam3-root");
        args.push_back(runtime.officialSam3Root.wstring());
#endif

        std::wstring command;
        for (const auto& arg : args) {
            if (!command.empty()) command.push_back(L' ');
            command += quoteArgument(arg);
        }

        STARTUPINFOW startup{};
        startup.cb = sizeof(startup);
        PROCESS_INFORMATION processInfo{};
        const BOOL created = CreateProcessW(
            python.c_str(), command.data(), nullptr, nullptr, FALSE,
            CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, nullptr, backendRoot.c_str(),
            &startup, &processInfo);
        if (!created) {
            std::filesystem::remove(tokenPath, ignored);
            throw std::runtime_error("Unable to launch the local SAM 3.1 backend.");
        }

        auto candidate = std::make_unique<BackendProcess>();
        candidate->process = processInfo.hProcess;
        candidate->thread = processInfo.hThread;
        candidate->pid = processInfo.dwProcessId;
        candidate->token = token;
        candidate->sessionRoot = sessionRoot;
        candidate->job = CreateJobObjectW(nullptr, nullptr);
        if (candidate->job) {
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION info{};
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            SetInformationJobObject(candidate->job, JobObjectExtendedLimitInformation, &info, sizeof(info));
            AssignProcessToJobObject(candidate->job, candidate->process);
        }

        const auto deadline = Clock::now() + std::chrono::seconds(90);
        std::optional<unsigned long> port;
        while (Clock::now() < deadline) {
            if (cancelRequested_.load()) {
                if (candidate->process) TerminateProcess(candidate->process, 73);
                std::filesystem::remove(readyPath, ignored);
                std::filesystem::remove(tokenPath, ignored);
                throw CancelledError("Inference was cancelled while the backend was starting.");
            }
            if (!candidate->alive()) break;
            std::ifstream ready(readyPath, std::ios::binary);
            if (ready) {
                const std::string json((std::istreambuf_iterator<char>(ready)), std::istreambuf_iterator<char>());
                port = extractJsonUnsigned(json, "port");
                if (port && *port > 0 && *port <= 65535) break;
            }
            Sleep(50);
        }
        std::filesystem::remove(readyPath, ignored);
        std::filesystem::remove(tokenPath, ignored);
        if (!port || !candidate->alive()) {
            if (candidate->process) TerminateProcess(candidate->process, 70);
            throw std::runtime_error("The local SAM 3.1 backend did not become ready.");
        }
        candidate->port = static_cast<std::uint16_t>(*port);
        const auto health = httpCall(candidate->port, candidate->token, "GET", "/v1/health", {}, 5000);
        if (health.status != 200 || !looksLikeJsonObject(health.body)) {
            TerminateProcess(candidate->process, 71);
            throw std::runtime_error("The local SAM 3.1 backend failed its health check.");
        }
        backend_ = std::move(candidate);
    }

    void stopBackend() {
        std::lock_guard lock(processMutex_);
        terminateLocked();
    }

    void terminateLocked() {
        if (!backend_) return;
        if (backend_->alive()) {
            TerminateProcess(backend_->process, 72);
            WaitForSingleObject(backend_->process, 5000);
        }
        backend_.reset();
    }

    std::unique_ptr<WsaSession> wsa_;
    std::mutex inferenceMutex_;
    std::mutex processMutex_;
    std::mutex stateMutex_;
    std::unique_ptr<BackendProcess> backend_;
    std::string activeRequestId_;
    std::atomic<bool> cancelRequested_{false};
    std::atomic<bool> shuttingDown_{false};
};

Engine& Engine::instance() {
    static Engine value;
    return value;
}

Engine::Engine() : impl_(new Impl) {}
Engine::~Engine() { delete impl_; }

std::string Engine::infer(std::string_view sessionRootNativePath, std::string_view requestJson) {
    return impl_->infer(sessionRootNativePath, requestJson);
}

bool Engine::cancel(std::string_view requestId) {
    return impl_->cancel(requestId);
}

void Engine::shutdown() {
    impl_->shutdown();
}

}  // namespace sam31::supervisor
