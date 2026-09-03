#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <bcrypt.h>

#include <algorithm>
#include <array>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace {

using Clock = std::chrono::steady_clock;

struct WsaSession {
    WsaSession() {
        WSADATA data{};
        if (WSAStartup(MAKEWORD(2, 2), &data) != 0) {
            throw std::runtime_error("WSAStartup failed");
        }
    }
    ~WsaSession() { WSACleanup(); }
    WsaSession(const WsaSession&) = delete;
    WsaSession& operator=(const WsaSession&) = delete;
};

struct SocketHandle {
    SOCKET value = INVALID_SOCKET;
    SocketHandle() = default;
    explicit SocketHandle(SOCKET socket) : value(socket) {}
    ~SocketHandle() {
        if (value != INVALID_SOCKET) closesocket(value);
    }
    SocketHandle(SocketHandle&& other) noexcept : value(other.value) {
        other.value = INVALID_SOCKET;
    }
    SocketHandle& operator=(SocketHandle&& other) noexcept {
        if (this != &other) {
            if (value != INVALID_SOCKET) closesocket(value);
            value = other.value;
            other.value = INVALID_SOCKET;
        }
        return *this;
    }
    SocketHandle(const SocketHandle&) = delete;
    SocketHandle& operator=(const SocketHandle&) = delete;
};

struct ProcessHandle {
    HANDLE process = nullptr;
    HANDLE thread = nullptr;
    DWORD pid = 0;
    ~ProcessHandle() { close(); }
    ProcessHandle() = default;
    ProcessHandle(ProcessHandle&& other) noexcept
        : process(other.process), thread(other.thread), pid(other.pid) {
        other.process = nullptr;
        other.thread = nullptr;
        other.pid = 0;
    }
    ProcessHandle& operator=(ProcessHandle&& other) noexcept {
        if (this != &other) {
            close();
            process = other.process;
            thread = other.thread;
            pid = other.pid;
            other.process = nullptr;
            other.thread = nullptr;
            other.pid = 0;
        }
        return *this;
    }
    ProcessHandle(const ProcessHandle&) = delete;
    ProcessHandle& operator=(const ProcessHandle&) = delete;
    void close() {
        if (thread) CloseHandle(thread);
        if (process) CloseHandle(process);
        thread = nullptr;
        process = nullptr;
        pid = 0;
    }
};

std::wstring quote(const std::wstring& value) {
    std::wstring result = L"\"";
    for (const wchar_t ch : value) {
        if (ch == L'\"') result += L'\\';
        result += ch;
    }
    result += L'\"';
    return result;
}

std::string randomToken() {
    std::array<unsigned char, 32> bytes{};
    const NTSTATUS status = BCryptGenRandom(
        nullptr,
        bytes.data(),
        static_cast<ULONG>(bytes.size()),
        BCRYPT_USE_SYSTEM_PREFERRED_RNG
    );
    if (status != 0) throw std::runtime_error("BCryptGenRandom failed");

    std::ostringstream out;
    out << std::hex << std::setfill('0');
    for (const auto byte : bytes) out << std::setw(2) << static_cast<unsigned int>(byte);
    return out.str();
}

std::wstring widen(const std::string& value) {
    if (value.empty()) return {};
    const int count = MultiByteToWideChar(CP_UTF8, 0, value.data(),
                                           static_cast<int>(value.size()), nullptr, 0);
    if (count <= 0) throw std::runtime_error("UTF-8 conversion failed");
    std::wstring result(static_cast<std::size_t>(count), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                        result.data(), count);
    return result;
}

std::string narrowAscii(const std::wstring& value) {
    std::string result;
    result.reserve(value.size());
    for (const wchar_t ch : value) {
        if (ch < 0 || ch > 0x7f) {
            throw std::runtime_error("expected ASCII argument");
        }
        result.push_back(static_cast<char>(ch));
    }
    return result;
}

std::filesystem::path executablePath() {
    std::wstring buffer(32768, L'\0');
    const DWORD count = GetModuleFileNameW(nullptr, buffer.data(),
                                           static_cast<DWORD>(buffer.size()));
    if (count == 0 || count >= buffer.size()) {
        throw std::runtime_error("GetModuleFileNameW failed");
    }
    buffer.resize(count);
    return std::filesystem::path(buffer);
}

bool processAlive(DWORD pid) {
    const HANDLE process = OpenProcess(SYNCHRONIZE, FALSE, pid);
    if (!process) return false;
    const DWORD result = WaitForSingleObject(process, 0);
    CloseHandle(process);
    return result == WAIT_TIMEOUT;
}

std::uint16_t reservePort() {
    SocketHandle socketHandle(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
    if (socketHandle.value == INVALID_SOCKET) throw std::runtime_error("socket failed");
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = 0;
    if (bind(socketHandle.value, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR) {
        throw std::runtime_error("bind ephemeral port failed");
    }
    int length = sizeof(address);
    if (getsockname(socketHandle.value, reinterpret_cast<sockaddr*>(&address), &length) == SOCKET_ERROR) {
        throw std::runtime_error("getsockname failed");
    }
    return ntohs(address.sin_port);
}

bool sendAll(SOCKET socketValue, std::string_view data) {
    std::size_t offset = 0;
    while (offset < data.size()) {
        const int sent = send(socketValue, data.data() + offset,
                              static_cast<int>(data.size() - offset), 0);
        if (sent <= 0) return false;
        offset += static_cast<std::size_t>(sent);
    }
    return true;
}

std::string receiveRequest(SOCKET socketValue) {
    std::string request;
    std::array<char, 4096> buffer{};
    while (request.find("\r\n\r\n") == std::string::npos && request.size() < 64 * 1024) {
        const int count = recv(socketValue, buffer.data(), static_cast<int>(buffer.size()), 0);
        if (count <= 0) break;
        request.append(buffer.data(), static_cast<std::size_t>(count));
    }
    return request;
}

std::string headerValue(const std::string& request, std::string_view name) {
    const std::string needle = std::string("\r\n") + std::string(name) + ":";
    auto pos = request.find(needle);
    if (pos == std::string::npos) return {};
    pos += needle.size();
    while (pos < request.size() && request[pos] == ' ') ++pos;
    auto end = request.find("\r\n", pos);
    if (end == std::string::npos) end = request.size();
    return request.substr(pos, end - pos);
}

std::string requestPath(const std::string& request) {
    const auto firstSpace = request.find(' ');
    if (firstSpace == std::string::npos) return {};
    const auto secondSpace = request.find(' ', firstSpace + 1);
    if (secondSpace == std::string::npos) return {};
    return request.substr(firstSpace + 1, secondSpace - firstSpace - 1);
}

std::string httpResponse(int status, std::string_view body) {
    const char* reason = status == 200 ? "OK" : status == 401 ? "Unauthorized" : "Not Found";
    std::ostringstream response;
    response << "HTTP/1.1 " << status << ' ' << reason << "\r\n"
             << "Content-Type: application/json\r\n"
             << "Content-Length: " << body.size() << "\r\n"
             << "Connection: close\r\n\r\n"
             << body;
    return response.str();
}

struct BackendOptions {
    std::uint16_t port = 0;
    std::string token;
    DWORD parentPid = 0;
    int idleMilliseconds = 3000;
    bool crashFirstInfer = false;
    std::filesystem::path crashMarker;
};

int runBackend(const BackendOptions& options) {
    WsaSession wsa;
    SocketHandle listener(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
    if (listener.value == INVALID_SOCKET) return 10;

    BOOL exclusive = TRUE;
    setsockopt(listener.value, SOL_SOCKET, SO_EXCLUSIVEADDRUSE,
               reinterpret_cast<const char*>(&exclusive), sizeof(exclusive));

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(options.port);
    if (bind(listener.value, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR) {
        return 11;
    }
    if (listen(listener.value, 8) == SOCKET_ERROR) return 12;

    auto lastActivity = Clock::now();
    bool running = true;
    while (running) {
        if (options.parentPid != 0 && !processAlive(options.parentPid)) return 0;
        const auto idle = std::chrono::duration_cast<std::chrono::milliseconds>(
            Clock::now() - lastActivity
        ).count();
        if (idle >= options.idleMilliseconds) return 0;

        fd_set readSet;
        FD_ZERO(&readSet);
        FD_SET(listener.value, &readSet);
        timeval timeout{};
        timeout.tv_sec = 0;
        timeout.tv_usec = 100000;
        const int selected = select(0, &readSet, nullptr, nullptr, &timeout);
        if (selected <= 0) continue;

        SocketHandle client(accept(listener.value, nullptr, nullptr));
        if (client.value == INVALID_SOCKET) continue;
        lastActivity = Clock::now();
        const std::string request = receiveRequest(client.value);
        const std::string auth = headerValue(request, "Authorization");
        if (auth != "Bearer " + options.token) {
            const auto response = httpResponse(401, R"({"error":"unauthorized"})");
            sendAll(client.value, response);
            continue;
        }

        const std::string path = requestPath(request);
        if (path == "/health") {
            const auto response = httpResponse(200, R"({"status":"ok","protocol":1})");
            sendAll(client.value, response);
        } else if (path == "/infer") {
            if (options.crashFirstInfer && !std::filesystem::exists(options.crashMarker)) {
                const HANDLE marker = CreateFileW(
                    options.crashMarker.c_str(),
                    GENERIC_WRITE,
                    0,
                    nullptr,
                    CREATE_NEW,
                    FILE_ATTRIBUTE_TEMPORARY,
                    nullptr
                );
                if (marker != INVALID_HANDLE_VALUE) {
                    constexpr char markerData[] = "crashed";
                    DWORD written = 0;
                    const BOOL wrote = WriteFile(
                        marker,
                        markerData,
                        static_cast<DWORD>(sizeof(markerData) - 1),
                        &written,
                        nullptr
                    );
                    const BOOL flushed = FlushFileBuffers(marker);
                    CloseHandle(marker);
                    if (wrote && flushed && written == sizeof(markerData) - 1) {
                        ExitProcess(33);
                    }
                    return 13;
                }
                if (GetLastError() != ERROR_FILE_EXISTS) return 14;
            }
            const auto response = httpResponse(
                200,
                R"({"status":"ok","mask":"mock","score":0.91})"
            );
            sendAll(client.value, response);
        } else if (path == "/shutdown") {
            const auto response = httpResponse(200, R"({"status":"stopping"})");
            sendAll(client.value, response);
            running = false;
        } else {
            const auto response = httpResponse(404, R"({"error":"not_found"})");
            sendAll(client.value, response);
        }
    }
    return 0;
}

struct HttpResult {
    bool connected = false;
    int status = 0;
    std::string raw;
};

HttpResult httpCall(std::uint16_t port, std::string_view token, std::string_view path) {
    WsaSession wsa;
    SocketHandle socketHandle(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
    if (socketHandle.value == INVALID_SOCKET) return {};

    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(port);
    if (connect(socketHandle.value, reinterpret_cast<sockaddr*>(&address), sizeof(address)) == SOCKET_ERROR) {
        return {};
    }

    std::ostringstream request;
    request << "POST " << path << " HTTP/1.1\r\n"
            << "Host: 127.0.0.1\r\n"
            << "Authorization: Bearer " << token << "\r\n"
            << "Content-Length: 0\r\nConnection: close\r\n\r\n";
    if (!sendAll(socketHandle.value, request.str())) return {true, 0, {}};

    std::string response;
    std::array<char, 4096> buffer{};
    for (;;) {
        const int count = recv(socketHandle.value, buffer.data(), static_cast<int>(buffer.size()), 0);
        if (count <= 0) break;
        response.append(buffer.data(), static_cast<std::size_t>(count));
    }

    int status = 0;
    const auto firstSpace = response.find(' ');
    if (firstSpace != std::string::npos && response.size() >= firstSpace + 4) {
        status = std::atoi(response.substr(firstSpace + 1, 3).c_str());
    }
    return {true, status, response};
}

bool waitForHealth(std::uint16_t port, const std::string& token, int milliseconds) {
    const auto deadline = Clock::now() + std::chrono::milliseconds(milliseconds);
    while (Clock::now() < deadline) {
        const auto result = httpCall(port, token, "/health");
        if (result.status == 200) return true;
        Sleep(50);
    }
    return false;
}

ProcessHandle startBackend(std::uint16_t port, const std::string& token,
                           const std::filesystem::path& marker, int idleMilliseconds) {
    const auto exe = executablePath();
    std::wostringstream command;
    command << quote(exe.wstring())
            << L" --backend --port " << port
            << L" --token " << widen(token)
            << L" --parent-pid " << GetCurrentProcessId()
            << L" --idle-ms " << idleMilliseconds
            << L" --crash-first --crash-marker " << quote(marker.wstring());

    std::wstring mutableCommand = command.str();
    STARTUPINFOW startup{};
    startup.cb = sizeof(startup);
    PROCESS_INFORMATION processInfo{};
    const BOOL created = CreateProcessW(
        nullptr,
        mutableCommand.data(),
        nullptr,
        nullptr,
        FALSE,
        CREATE_NO_WINDOW,
        nullptr,
        exe.parent_path().c_str(),
        &startup,
        &processInfo
    );
    if (!created) throw std::runtime_error("CreateProcessW failed");

    ProcessHandle result;
    result.process = processInfo.hProcess;
    result.thread = processInfo.hThread;
    result.pid = processInfo.dwProcessId;
    return result;
}

std::optional<std::wstring> argumentValue(int argc, wchar_t** argv, std::wstring_view name) {
    for (int i = 1; i + 1 < argc; ++i) {
        if (argv[i] == name) return std::wstring(argv[i + 1]);
    }
    return std::nullopt;
}

bool hasArgument(int argc, wchar_t** argv, std::wstring_view name) {
    for (int i = 1; i < argc; ++i) {
        if (argv[i] == name) return true;
    }
    return false;
}

int selfTest() {
    WsaSession initialWsa;
    const auto port = reservePort();
    const auto token = randomToken();
    const auto marker = std::filesystem::temp_directory_path() /
        (L"lifecycle-crash-once-" + std::to_wstring(GetCurrentProcessId()) + L".marker");
    std::error_code ignored;
    std::filesystem::remove(marker, ignored);

    constexpr int idleMs = 1400;
    int starts = 0;
    bool unauthorizedRejected = false;
    bool restarted = false;
    bool idleExited = false;

    auto child = startBackend(port, token, marker, idleMs);
    ++starts;
    if (!waitForHealth(port, token, 5000)) {
        TerminateProcess(child.process, 90);
        throw std::runtime_error("backend did not become healthy");
    }

    unauthorizedRejected = httpCall(port, "wrong-token", "/health").status == 401;

    auto infer = httpCall(port, token, "/infer");
    if (infer.status != 200) {
        WaitForSingleObject(child.process, 3000);
        child.close();
        auto replacement = startBackend(port, token, marker, idleMs);
        child = std::move(replacement);
        ++starts;
        restarted = true;
        if (!waitForHealth(port, token, 5000)) {
            TerminateProcess(child.process, 91);
            throw std::runtime_error("replacement backend did not become healthy");
        }
        infer = httpCall(port, token, "/infer");
    }

    if (infer.status != 200) {
        TerminateProcess(child.process, 92);
        throw std::runtime_error("retry inference failed");
    }

    const DWORD waitResult = WaitForSingleObject(child.process, idleMs + 4000);
    idleExited = waitResult == WAIT_OBJECT_0;
    if (!idleExited) TerminateProcess(child.process, 93);
    child.close();
    std::filesystem::remove(marker, ignored);

    const bool passed = starts == 2 && unauthorizedRejected && restarted && idleExited;
    std::cout << "{\n"
              << "  \"status\": \"" << (passed ? "PASS" : "FAIL") << "\",\n"
              << "  \"loopbackOnly\": true,\n"
              << "  \"tokenBytes\": 32,\n"
              << "  \"unauthorizedRejected\": " << (unauthorizedRejected ? "true" : "false") << ",\n"
              << "  \"backendStarts\": " << starts << ",\n"
              << "  \"restartAfterCrash\": " << (restarted ? "true" : "false") << ",\n"
              << "  \"retrySucceeded\": " << (infer.status == 200 ? "true" : "false") << ",\n"
              << "  \"idleExit\": " << (idleExited ? "true" : "false") << "\n"
              << "}\n";
    return passed ? 0 : 1;
}

} // namespace

int wmain(int argc, wchar_t** argv) {
    try {
        if (hasArgument(argc, argv, L"--backend")) {
            BackendOptions options;
            options.port = static_cast<std::uint16_t>(std::stoi(argumentValue(argc, argv, L"--port").value()));
            const auto tokenWide = argumentValue(argc, argv, L"--token").value();
            options.token = narrowAscii(tokenWide);
            options.parentPid = static_cast<DWORD>(std::stoul(argumentValue(argc, argv, L"--parent-pid").value()));
            options.idleMilliseconds = std::stoi(argumentValue(argc, argv, L"--idle-ms").value());
            options.crashFirstInfer = hasArgument(argc, argv, L"--crash-first");
            options.crashMarker = argumentValue(argc, argv, L"--crash-marker").value();
            return runBackend(options);
        }
        return selfTest();
    } catch (const std::exception& error) {
        std::cerr << "lifecycle PoC failed: " << error.what() << '\n';
        return 2;
    }
}
