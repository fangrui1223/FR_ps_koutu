// Argument-free Windows entry point for ExtendScript File.execute(). No shell.
// Claims only fresh fixed-layout jobs in the current user's temporary directory.
#include <windows.h>
#include <filesystem>
#include <fstream>
#include <string>
#include <stdexcept>
#include "runtime_config.h"

namespace fs = std::filesystem;
namespace {
constexpr ULONGLONG kJobTimeoutMs = 25 * 60 * 1000;
bool plainEntry(const fs::path& path, bool directory) {
    const auto attrs = GetFileAttributesW(path.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_REPARSE_POINT) &&
        static_cast<bool>(attrs & FILE_ATTRIBUTE_DIRECTORY) == directory;
}
bool jobName(const std::wstring& name) {
    if (name.size() < 7 || name.size() > 64 || name.substr(0, 4) != L"jsx-") return false;
    const auto split = name.find(L'-', 4);
    if (split == std::wstring::npos || split == 4 || split + 1 == name.size()) return false;
    for (size_t i = 4; i < name.size(); ++i)
        if (i != split && (name[i] < L'0' || name[i] > L'9')) return false;
    return true;
}
bool fresh(const fs::path& file) {
    WIN32_FILE_ATTRIBUTE_DATA data{};
    if (!GetFileAttributesExW(file.c_str(), GetFileExInfoStandard, &data)) return false;
    FILETIME now{}; GetSystemTimeAsFileTime(&now);
    ULARGE_INTEGER a{}, b{};
    a.LowPart = now.dwLowDateTime; a.HighPart = now.dwHighDateTime;
    b.LowPart = data.ftLastWriteTime.dwLowDateTime; b.HighPart = data.ftLastWriteTime.dwHighDateTime;
    return a.QuadPart >= b.QuadPart && a.QuadPart - b.QuadPart < 120ULL * 10000000;
}
// Standard Windows argv quoting, not shell escaping.
std::wstring quote(const fs::path& path) {
    std::wstring result = L"\"";
    size_t slashes = 0;
    for (wchar_t c : path.native()) {
        if (c == L'\\') { ++slashes; continue; }
        result.append(slashes * (c == L'"' ? 2 : 1), L'\\'); slashes = 0;
        if (c == L'"') result += L'\\';
        result += c;
    }
    result.append(slashes * 2, L'\\');
    return result + L'"';
}
void finish(const fs::path& job, const std::string& result) {
    const auto partial = job / L"launcher.done.partial";
    { std::ofstream out(partial, std::ios::binary); out << result; if (!out) return; }
    MoveFileExW(partial.c_str(), (job / L"launcher.done").c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH);
}
void runJob(const fs::path& root, const fs::path& job) {
    try {
        if (!plainEntry(job / L"request.json", false) || fs::file_size(job / L"request.json") > 32768)
            throw std::runtime_error("Invalid request file.");
        const auto config = sam31::supervisor::loadRuntimeConfig();
        const auto script = config.backendRoot / L"sam31_backend" / L"legacy_bridge.py";
        if (!plainEntry(script, false)) throw std::runtime_error("Installed bridge client is missing.");
        auto command = quote(config.python) + L" " + quote(script) +
            L" --session-root " + quote(root) + L" --request-file " + quote(job / L"request.json") +
            L" --response-file " + quote(job / L"response.json") +
            L" --model-checkpoint " + quote(config.modelCheckpoint) +
            L" --official-sam3-root " + quote(config.officialSam3Root);
        STARTUPINFOW startup{}; startup.cb = sizeof(startup);
        startup.dwFlags = STARTF_USESHOWWINDOW; startup.wShowWindow = SW_HIDE;
        PROCESS_INFORMATION process{};
        if (!CreateProcessW(config.python.c_str(), command.data(), nullptr, nullptr, FALSE,
                            CREATE_NO_WINDOW, nullptr, config.backendRoot.c_str(), &startup, &process))
            throw std::runtime_error("Cannot start installed Python (Windows error " + std::to_string(GetLastError()) + ").");
        CloseHandle(process.hThread);
        const auto started = GetTickCount64();
        bool stopped = false;
        DWORD waitStatus;
        while ((waitStatus = WaitForSingleObject(process.hProcess, 50)) == WAIT_TIMEOUT) {
            std::error_code fileError;
            if (!plainEntry(job, true) || fs::exists(job / L"launcher.cancel", fileError) || fileError || GetTickCount64() - started > kJobTimeoutMs) {
                TerminateProcess(process.hProcess, ERROR_CANCELLED);
                WaitForSingleObject(process.hProcess, 5000); stopped = true; break;
            }
        }
        if (waitStatus == WAIT_FAILED) {
            TerminateProcess(process.hProcess, ERROR_CANCELLED);
            WaitForSingleObject(process.hProcess, 5000); stopped = true;
        }
        DWORD exitCode = 1; GetExitCodeProcess(process.hProcess, &exitCode); CloseHandle(process.hProcess);
        if (stopped) throw std::runtime_error("Local bridge cancelled or timed out.");
        if (exitCode != 0 || !plainEntry(job / L"response.json", false))
            throw std::runtime_error("Local bridge exited without a response (code " + std::to_string(exitCode) + ").");
        finish(job, "ok");
    } catch (const std::exception& error) { finish(job, std::string("error: ") + error.what()); }
      catch (...) { finish(job, "error: Unexpected local launcher failure."); }
}
}
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    try {
        wchar_t temp[32768]{};
        const auto count = GetTempPathW(32768, temp);
        if (!count || count >= 32768) return 1;
        const auto root = fs::path(temp) / L"sam31-selection-legacy";
        if (!plainEntry(root, true)) return 0;
        for (const auto& entry : fs::directory_iterator(root)) {
            const auto job = entry.path();
            if (!jobName(job.filename().native()) || !plainEntry(job, true)) continue;
            const auto ready = job / L"launcher.ready";
            if (!plainEntry(ready, false) || fs::exists(job / L"launcher.cancel")) continue;
            if (!fresh(ready)) { finish(job, "error: Expired launcher request; run the action again."); continue; }
            // Atomic claim; concurrent invocations cannot run the same job twice.
            if (!MoveFileW(ready.c_str(), (job / L"launcher.claimed").c_str())) continue;
            runJob(root, job);
        }
        return 0;
    } catch (...) { return 1; } // Never open a modal error window in a batch.
}
