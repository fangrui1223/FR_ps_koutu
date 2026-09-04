#pragma once

#include <filesystem>

namespace sam31::supervisor {

struct RuntimeConfig {
    std::filesystem::path installRoot;
    std::filesystem::path python;
    std::filesystem::path backendRoot;
    std::filesystem::path modelCheckpoint;
    std::filesystem::path officialSam3Root;
    std::filesystem::path source;
};

// Release builds load a current-user configuration from
// the Windows LocalAppData known folder, then an HKCU installer pointer and
// environment fallbacks. Tests and build tooling may override that location
// with SAM31_RUNTIME_CONFIG.
RuntimeConfig loadRuntimeConfig();
RuntimeConfig loadRuntimeConfigFile(const std::filesystem::path& path);

}  // namespace sam31::supervisor
