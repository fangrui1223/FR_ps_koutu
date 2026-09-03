#pragma once

#include <stdexcept>
#include <string>
#include <string_view>

namespace sam31::supervisor {

class CancelledError final : public std::runtime_error {
 public:
    explicit CancelledError(const std::string& message) : std::runtime_error(message) {}
};

class Engine final {
 public:
    static Engine& instance();

    std::string infer(std::string_view sessionRootNativePath, std::string_view requestJson);
    bool cancel(std::string_view requestId);
    void shutdown();

    Engine(const Engine&) = delete;
    Engine& operator=(const Engine&) = delete;

 private:
    Engine();
    ~Engine();

    class Impl;
    Impl* impl_;
};

}  // namespace sam31::supervisor
