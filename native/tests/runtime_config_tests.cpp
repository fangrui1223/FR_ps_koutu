#include "runtime_config.h"

#include <windows.h>

#include <array>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

class TempRoot {
 public:
    TempRoot() {
        std::array<wchar_t, 32768> buffer{};
        const DWORD count = GetTempPathW(static_cast<DWORD>(buffer.size()), buffer.data());
        if (count == 0 || count >= buffer.size()) throw std::runtime_error("GetTempPathW failed");
        root = std::filesystem::path(buffer.data()) /
            (L"sam31-runtime-config-tests-" + std::to_wstring(GetCurrentProcessId()) + L"-" +
             std::to_wstring(GetTickCount64()));
        std::filesystem::create_directories(root / "runtime");
        std::filesystem::create_directories(root / "backend");
        std::filesystem::create_directories(root / "vendor" / "sam3");
        std::filesystem::create_directories(root / "models");
        touch(root / "runtime" / "python.exe");
        touch(root / "models" / "model.safetensors");
    }

    ~TempRoot() {
        std::error_code ignored;
        std::filesystem::remove_all(root, ignored);
    }

    static void touch(const std::filesystem::path& path) {
        std::ofstream stream(path, std::ios::binary);
        stream << 'x';
    }

    std::filesystem::path write(std::string_view body, std::string_view name = "runtime-v1.ini") const {
        const auto path = root / name;
        std::ofstream stream(path, std::ios::binary);
        stream << body;
        return path;
    }

    std::filesystem::path root;
};

std::string utf8(const std::filesystem::path& path) {
    const auto wide = path.wstring();
    const int count = WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()),
                                          nullptr, 0, nullptr, nullptr);
    std::string result(static_cast<std::size_t>(count), '\0');
    WideCharToMultiByte(CP_UTF8, 0, wide.data(), static_cast<int>(wide.size()), result.data(), count,
                        nullptr, nullptr);
    return result;
}

template <typename Function>
void expectFailure(Function&& function, const char* label) {
    try {
        function();
    } catch (const std::exception&) {
        return;
    }
    throw std::runtime_error(std::string("Expected failure: ") + label);
}

}  // namespace

int wmain() {
    try {
        TempRoot fixture;
        const std::string prefix =
            "schemaVersion=1\ninstallRoot=" + utf8(fixture.root) +
            "\npython=runtime\\python.exe\nbackend=backend\nmodel=models\\model.safetensors\n";
        const auto valid = fixture.write(prefix + "officialSam3=vendor\\sam3\n");
        const auto config = sam31::supervisor::loadRuntimeConfigFile(valid);
        if (config.python.filename() != L"python.exe" ||
            config.modelCheckpoint.filename() != L"model.safetensors" ||
            config.officialSam3Root.filename() != L"sam3") {
            throw std::runtime_error("Valid runtime configuration was resolved incorrectly");
        }

        const auto traversal = fixture.write(
            prefix + "officialSam3=..\\outside\n", "traversal.ini");
        expectFailure([&] { sam31::supervisor::loadRuntimeConfigFile(traversal); }, "path traversal");

        const auto unknown = fixture.write(
            prefix + "officialSam3=vendor\\sam3\nunexpected=value\n", "unknown.ini");
        expectFailure([&] { sam31::supervisor::loadRuntimeConfigFile(unknown); }, "unknown field");

        const auto duplicate = fixture.write(
            prefix + "officialSam3=vendor\\sam3\npython=runtime\\python.exe\n", "duplicate.ini");
        expectFailure([&] { sam31::supervisor::loadRuntimeConfigFile(duplicate); }, "duplicate field");

        std::cout << "{\"status\":\"PASS\",\"runtimeConfig\":\"v1\"}\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << "runtime config tests failed: " << error.what() << '\n';
        return 1;
    }
}
