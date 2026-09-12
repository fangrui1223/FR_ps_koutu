#define wWinMain launcherEntryForTest
#include "../src/legacy_launcher.cpp"
#undef wWinMain
#include <iostream>

void check(bool ok, const char* why) { if (!ok) throw std::runtime_error(why); }
std::string read(const fs::path& file) { std::ifstream in(file); return {std::istreambuf_iterator<char>(in), {}}; }
int wmain(int argc, wchar_t** argv) {
    fs::path testRoot;
    try {
        check(argc == 2, "child executable required");
        check(jobName(L"jsx-123456-789") && !jobName(L"jsx-../..") && !jobName(L"jsx-1-2-3"), "job names");
        check(quote(fs::path(L"C:\\a b\\")) == L"\"C:\\a b\\\\\"", "trailing slash quoting");
        wchar_t temp[32768]{}; GetTempPathW(32768, temp);
        testRoot = fs::path(temp) / (L"FR-SAM-launcher-QA-中文-" + std::to_wstring(GetCurrentProcessId()));
        check(!fs::exists(testRoot), "fresh test root required");
        fs::create_directories(testRoot / L"backend/sam31_backend");
        fs::create_directories(testRoot / L"vendor");
        fs::copy_file(argv[1], testRoot / L"python.exe");
        std::ofstream(testRoot / L"model.bin") << "mock";
        std::ofstream(testRoot / L"backend/sam31_backend/legacy_bridge.py") << "mock";
        const auto config = testRoot / L"runtime-v2.ini";
        auto rootUtf8 = testRoot.u8string();
        std::ofstream(config) << "schemaVersion=1\ninstallRoot=" << std::string(rootUtf8.begin(), rootUtf8.end())
            << "\npython=python.exe\nbackend=backend\nmodel=model.bin\nofficialSam3=vendor\n";
        SetEnvironmentVariableW(L"SAM31_RUNTIME_CONFIG", config.c_str());
        auto job = testRoot / L"jsx-123-456"; fs::create_directory(job);
        std::ofstream(job / L"request.json") << "ok";
        std::ofstream(job / L"launcher.ready") << "1";
        check(fresh(job / L"launcher.ready"), "fresh job");
        runJob(testRoot, job);
        check(read(job / L"launcher.done") == "ok", "successful completion");
        check(read(job / L"response.json") == "no-console", "child must have no console");
        std::ofstream(job / L"request.json") << "fail";
        runJob(testRoot, job);
        check(read(job / L"launcher.done").find("code 8") != std::string::npos, "nonzero exit");
        std::ofstream(job / L"request.json") << "sleep";
        std::ofstream(job / L"launcher.cancel") << "1";
        const auto before = GetTickCount64(); runJob(testRoot, job);
        check(GetTickCount64() - before < 5000 && read(job / L"launcher.done").find("cancelled") != std::string::npos, "cancellation");
        fs::remove(job / L"request.json"); runJob(testRoot, job);
        check(read(job / L"launcher.done").find("Invalid request") != std::string::npos, "missing request");
        SetEnvironmentVariableW(L"SAM31_RUNTIME_CONFIG", nullptr);
        fs::remove_all(testRoot);
        std::cout << "PASS: validation, Unicode paths, hidden child, failure, cancellation, atomic completion\n";
        return 0;
    } catch (const std::exception& error) {
        std::cerr << error.what() << "\n"; return 1;
    }
}
