#include "supervisor.h"
#include "build_config.h"

#include <windows.h>

#include <array>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

class TempSession {
 public:
    TempSession() {
        std::array<wchar_t, 32768> buffer{};
        const DWORD count = GetTempPathW(static_cast<DWORD>(buffer.size()), buffer.data());
        if (count == 0 || count >= buffer.size()) throw std::runtime_error("GetTempPathW failed");
        root = std::filesystem::path(buffer.data()) /
            (L"sam31-supervisor-smoke-" + std::to_wstring(GetCurrentProcessId()) + L"-" +
             std::to_wstring(GetTickCount64()));
        std::filesystem::create_directories(root / "smoke-0001");
    }

    ~TempSession() {
        std::error_code ignored;
        const auto temp = std::filesystem::temp_directory_path();
        const auto absolute = std::filesystem::absolute(root);
        if (absolute.parent_path() == std::filesystem::absolute(temp) &&
            absolute.filename().wstring().starts_with(L"sam31-supervisor-smoke-")) {
            std::filesystem::remove_all(absolute, ignored);
        }
    }

    std::filesystem::path root;
};

void writeInput(const std::filesystem::path& path) {
    const std::array<unsigned char, 16> rgba = {
        10, 20, 30, 0,
        10, 20, 30, 64,
        10, 20, 30, 128,
        10, 20, 30, 255,
    };
    std::ofstream stream(path, std::ios::binary);
    stream.write(reinterpret_cast<const char*>(rgba.data()), static_cast<std::streamsize>(rgba.size()));
    if (!stream) throw std::runtime_error("Unable to write smoke input");
}

std::string requestJson() {
    return R"({"schemaVersion":1,"requestId":"smoke-0001","modelId":"sam3.1-multiplex-fp16","prompts":["pants"],"threshold":0.5,"document":{"width":2,"height":2},"input":{"file":"smoke-0001/input.rgba8","encoding":"rgba8","width":2,"height":2,"bounds":{"left":0,"top":0,"right":2,"bottom":2}},"roi":null,"output":{"file":"smoke-0001/mask.gray8","encoding":"gray8"}})";
}

}  // namespace

int wmain() {
    try {
        TempSession session;
        writeInput(session.root / "smoke-0001" / "input.rgba8");
        const std::string response = sam31::supervisor::Engine::instance().infer(
            session.root.string(), requestJson());
#if SAM31_BACKEND_MOCK_ALPHA
        if (response.find("\"status\":\"ok\"") == std::string::npos) {
            throw std::runtime_error("Unexpected backend response: " + response);
        }
        std::ifstream maskStream(session.root / "smoke-0001" / "mask.gray8", std::ios::binary);
        const std::array<unsigned char, 4> expected = {0, 64, 128, 255};
        std::array<unsigned char, 4> actual{};
        maskStream.read(reinterpret_cast<char*>(actual.data()), static_cast<std::streamsize>(actual.size()));
        if (!maskStream || actual != expected) throw std::runtime_error("Mask bytes do not match alpha proxy");
#else
        if (response.find("\"code\":\"NO_OBJECT\"") == std::string::npos ||
            response.find("\"retryable\":false") == std::string::npos) {
            throw std::runtime_error("Unexpected formal backend response: " + response);
        }
#endif
        sam31::supervisor::Engine::instance().shutdown();
        std::cout << "{\"status\":\"PASS\",\"transport\":\"uxp-supervisor-core\",\"mode\":\""
#if SAM31_BACKEND_MOCK_ALPHA
                  << "mock"
#else
                  << "formal"
#endif
                  << "\"}\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "supervisor smoke failed: " << error.what() << '\n';
        return 1;
    }
}
