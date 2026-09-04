#include "runtime_config.h"

#include "build_config.h"

#include <windows.h>
#include <shlobj.h>

#include <algorithm>
#include <cctype>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <vector>

namespace sam31::supervisor {
namespace {

std::string trim(std::string value) {
    const auto notSpace = [](unsigned char ch) { return std::isspace(ch) == 0; };
    const auto first = std::find_if(value.begin(), value.end(), notSpace);
    if (first == value.end()) return {};
    const auto last = std::find_if(value.rbegin(), value.rend(), notSpace).base();
    return std::string(first, last);
}

std::wstring widen(std::string_view value) {
    if (value.empty()) return {};
    const int count = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                                          static_cast<int>(value.size()), nullptr, 0);
    if (count <= 0) throw std::runtime_error("Runtime configuration is not valid UTF-8.");
    std::wstring result(static_cast<std::size_t>(count), L'\0');
    if (MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(),
                            static_cast<int>(value.size()), result.data(), count) != count) {
        throw std::runtime_error("Runtime configuration is not valid UTF-8.");
    }
    return result;
}

std::filesystem::path environmentPath(const wchar_t* name) {
    const DWORD required = GetEnvironmentVariableW(name, nullptr, 0);
    if (required == 0) return {};
    std::wstring value(required, L'\0');
    const DWORD written = GetEnvironmentVariableW(name, value.data(), required);
    if (written == 0 || written >= required) return {};
    value.resize(written);
    return std::filesystem::path(value);
}

std::filesystem::path knownFolderPath(REFKNOWNFOLDERID folderId) {
    PWSTR raw = nullptr;
    const HRESULT result = SHGetKnownFolderPath(folderId, KF_FLAG_DEFAULT, nullptr, &raw);
    if (FAILED(result) || raw == nullptr) {
        if (raw != nullptr) CoTaskMemFree(raw);
        return {};
    }
    const std::filesystem::path path(raw);
    CoTaskMemFree(raw);
    return path;
}

std::filesystem::path registryRuntimeConfigPath() {
    constexpr wchar_t key[] = L"Software\\FR\\FR SAM Text Selection";
    constexpr wchar_t valueName[] = L"RuntimeConfig";
    DWORD type = 0;
    DWORD bytes = 0;
    const LSTATUS query = RegGetValueW(HKEY_CURRENT_USER, key, valueName, RRF_RT_REG_SZ,
                                       &type, nullptr, &bytes);
    if (query != ERROR_SUCCESS || bytes < sizeof(wchar_t)) return {};

    std::wstring value(bytes / sizeof(wchar_t), L'\0');
    const LSTATUS read = RegGetValueW(HKEY_CURRENT_USER, key, valueName, RRF_RT_REG_SZ,
                                      &type, value.data(), &bytes);
    if (read != ERROR_SUCCESS) return {};
    while (!value.empty() && value.back() == L'\0') value.pop_back();
    return std::filesystem::path(value);
}

void appendUnique(std::vector<std::filesystem::path>& paths, std::filesystem::path candidate) {
    if (candidate.empty()) return;
    candidate = candidate.lexically_normal();
    const auto duplicate = std::find_if(paths.begin(), paths.end(), [&](const auto& existing) {
        return _wcsicmp(existing.c_str(), candidate.c_str()) == 0;
    });
    if (duplicate == paths.end()) paths.push_back(std::move(candidate));
}

std::vector<std::filesystem::path> runtimeConfigCandidates() {
    constexpr wchar_t relative[] = L"FR\\FR SAM Text Selection\\runtime-v2.ini";
    std::vector<std::filesystem::path> paths;
    const auto localAppData = knownFolderPath(FOLDERID_LocalAppData);
    if (!localAppData.empty()) appendUnique(paths, localAppData / relative);
    appendUnique(paths, registryRuntimeConfigPath());
    const auto environmentLocalAppData = environmentPath(L"LOCALAPPDATA");
    if (!environmentLocalAppData.empty()) appendUnique(paths, environmentLocalAppData / relative);
    const auto userProfile = environmentPath(L"USERPROFILE");
    if (!userProfile.empty()) appendUnique(paths, userProfile / L"AppData\\Local" / relative);
    return paths;
}

std::string utf8Path(const std::filesystem::path& path) {
    const auto value = path.wstring();
    if (value.empty()) return {};
    const int count = WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()),
                                          nullptr, 0, nullptr, nullptr);
    if (count <= 0) return "<unprintable path>";
    std::string result(static_cast<std::size_t>(count), '\0');
    WideCharToMultiByte(CP_UTF8, 0, value.data(), static_cast<int>(value.size()), result.data(),
                        count, nullptr, nullptr);
    return result;
}

std::filesystem::path checkedExisting(const std::filesystem::path& path, const char* label,
                                      bool directory) {
    std::error_code error;
    const auto absolute = std::filesystem::absolute(path, error).lexically_normal();
    if (error || absolute.empty()) {
        throw std::runtime_error(std::string("Configured ") + label + " path is invalid.");
    }
    const bool expectedType = directory ? std::filesystem::is_directory(absolute, error)
                                        : std::filesystem::is_regular_file(absolute, error);
    if (error || !expectedType) {
        throw std::runtime_error(std::string("Configured ") + label + " does not exist.");
    }
    return absolute;
}

std::filesystem::path resolveChild(const std::filesystem::path& root, std::string_view raw,
                                   const char* label, bool directory) {
    const std::filesystem::path relative(widen(raw));
    if (relative.empty() || relative.is_absolute() || relative.has_root_name() || relative.has_root_directory()) {
        throw std::runtime_error(std::string("Configured ") + label + " must be relative to installRoot.");
    }
    const auto candidate = (root / relative).lexically_normal();
    const auto relation = candidate.lexically_relative(root);
    if (relation.empty() || relation == L".." ||
        (!relation.empty() && *relation.begin() == L"..")) {
        throw std::runtime_error(std::string("Configured ") + label + " escapes installRoot.");
    }
    return checkedExisting(candidate, label, directory);
}

RuntimeConfig developmentFallback() {
#if SAM31_ALLOW_DEV_FALLBACK
    RuntimeConfig config;
    config.python = checkedExisting(std::filesystem::path(SAM31_BACKEND_PYTHON),
                                    "development Python runtime", false);
    config.backendRoot = checkedExisting(std::filesystem::path(SAM31_BACKEND_ROOT),
                                         "development backend root", true);
    config.modelCheckpoint = checkedExisting(std::filesystem::path(SAM31_MODEL_CHECKPOINT),
                                              "development model checkpoint", false);
    config.officialSam3Root = checkedExisting(std::filesystem::path(SAM31_OFFICIAL_SAM3_ROOT),
                                              "development official SAM 3 root", true);
    config.installRoot = config.backendRoot.parent_path();
    config.source = L"<compiled-development-fallback>";
    return config;
#else
    throw std::runtime_error(
        "SAM 3.1 runtime is not installed. Run the Windows backend installer first.");
#endif
}

}  // namespace

RuntimeConfig loadRuntimeConfigFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) throw std::runtime_error("Unable to read the installed SAM 3.1 runtime configuration.");
    std::string content((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    if (content.size() >= 3 && static_cast<unsigned char>(content[0]) == 0xEF &&
        static_cast<unsigned char>(content[1]) == 0xBB &&
        static_cast<unsigned char>(content[2]) == 0xBF) {
        content.erase(0, 3);
    }

    std::map<std::string, std::string> values;
    std::istringstream lines(content);
    std::string line;
    std::size_t lineNumber = 0;
    while (std::getline(lines, line)) {
        ++lineNumber;
        if (!line.empty() && line.back() == '\r') line.pop_back();
        line = trim(line);
        if (line.empty() || line.front() == '#') continue;
        const auto equals = line.find('=');
        if (equals == std::string::npos) {
            throw std::runtime_error("Invalid runtime configuration line " + std::to_string(lineNumber) + ".");
        }
        const auto key = trim(line.substr(0, equals));
        const auto value = trim(line.substr(equals + 1));
        if (key.empty() || value.empty() || !values.emplace(key, value).second) {
            throw std::runtime_error("Duplicate or empty runtime configuration field on line " +
                                     std::to_string(lineNumber) + ".");
        }
    }

    static const std::map<std::string, bool> allowed = {
        {"schemaVersion", true}, {"installRoot", true}, {"python", true},
        {"backend", true}, {"model", true}, {"officialSam3", true},
    };
    for (const auto& [key, ignored] : values) {
        (void)ignored;
        if (!allowed.contains(key)) {
            throw std::runtime_error("Unknown runtime configuration field: " + key + ".");
        }
    }
    for (const auto& [key, ignored] : allowed) {
        (void)ignored;
        if (!values.contains(key)) {
            throw std::runtime_error("Missing runtime configuration field: " + key + ".");
        }
    }
    const auto schemaVersion = values.at("schemaVersion");
    if (schemaVersion != "1" && schemaVersion != "2") {
        throw std::runtime_error("Unsupported FR SAM runtime configuration version.");
    }

    const std::filesystem::path rootValue(widen(values.at("installRoot")));
    if (!rootValue.is_absolute()) throw std::runtime_error("Configured installRoot must be absolute.");
    const auto root = checkedExisting(rootValue, "install root", true);

    RuntimeConfig result;
    result.installRoot = root;
    result.python = resolveChild(root, values.at("python"), "Python runtime", false);
    result.backendRoot = resolveChild(root, values.at("backend"), "backend root", true);
    result.modelCheckpoint = schemaVersion == "2"
        ? checkedExisting(std::filesystem::path(widen(values.at("model"))),
                          "external model checkpoint", false)
        : resolveChild(root, values.at("model"), "model checkpoint", false);
    result.officialSam3Root = resolveChild(root, values.at("officialSam3"), "official SAM 3 root", true);
    result.source = std::filesystem::absolute(path).lexically_normal();
    return result;
}

RuntimeConfig loadRuntimeConfig() {
    const auto overridePath = environmentPath(L"SAM31_RUNTIME_CONFIG");
    if (!overridePath.empty()) return loadRuntimeConfigFile(overridePath);

    const auto candidates = runtimeConfigCandidates();
    std::vector<std::string> diagnostics;
    for (const auto& path : candidates) {
        std::error_code error;
        if (std::filesystem::is_regular_file(path, error) && !error) {
            return loadRuntimeConfigFile(path);
        }
        std::string detail = utf8Path(path);
        detail += error ? " (" + error.message() + ")" : " (not a regular file)";
        diagnostics.push_back(std::move(detail));
    }

#if SAM31_ALLOW_DEV_FALLBACK
    return developmentFallback();
#else
    std::ostringstream message;
    message << "未找到或无法访问 FR SAM 运行时配置。";
    if (!diagnostics.empty()) {
        message << " 已检查：";
        for (const auto& detail : diagnostics) message << " " << detail << ";";
    } else {
        message << " Windows 无法解析当前用户的 LocalAppData 路径。";
    }
    message << " 请重新运行 Windows 后端安装器，然后重启 Photoshop。";
    throw std::runtime_error(message.str());
#endif
}

}  // namespace sam31::supervisor
