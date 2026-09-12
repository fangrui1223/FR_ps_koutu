#include <windows.h>
#include <filesystem>
#include <fstream>
#include <string>
int wmain(int argc, wchar_t** argv) {
    std::filesystem::path request, response;
    for (int i = 1; i + 1 < argc; ++i) {
        if (std::wstring(argv[i]) == L"--request-file") request = argv[++i];
        else if (std::wstring(argv[i]) == L"--response-file") response = argv[++i];
    }
    std::ifstream input(request);
    std::string mode; input >> mode;
    if (mode == "fail") return 8;
    if (mode == "sleep") Sleep(30000);
    std::ofstream output(response);
    output << (GetConsoleWindow() == nullptr ? "no-console" : "console");
    return output ? 0 : 9;
}
