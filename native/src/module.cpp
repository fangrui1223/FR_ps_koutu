#include "UxpAddon.h"
#include "supervisor.h"

#include <exception>
#include <stdexcept>
#include <string>
#include <thread>
#include <utility>

namespace {

using sam31::supervisor::Engine;

std::string readString(addon_env env, addon_value value) {
    size_t length = 0;
    if (UxpAddonApis.uxp_addon_get_value_string_utf8(env, value, nullptr, 0, &length) != addon_ok) {
        throw std::runtime_error("Expected a UTF-8 string argument.");
    }
    std::string result(length + 1, '\0');
    size_t written = 0;
    if (UxpAddonApis.uxp_addon_get_value_string_utf8(
            env, value, result.data(), result.size(), &written) != addon_ok) {
        throw std::runtime_error("Unable to read UTF-8 string argument.");
    }
    result.resize(written);
    if (!result.empty() && result.back() == '\0') result.pop_back();
    return result;
}

std::pair<std::string, std::string> readInferArguments(addon_env env, addon_callback_info info) {
    addon_value args[2] = {nullptr, nullptr};
    size_t argc = 2;
    if (UxpAddonApis.uxp_addon_get_cb_info(env, info, &argc, args, nullptr, nullptr) != addon_ok || argc != 2) {
        throw std::runtime_error("infer requires sessionRootNativePath and requestJson.");
    }
    return {readString(env, args[0]), readString(env, args[1])};
}

std::string readCancelArgument(addon_env env, addon_callback_info info) {
    addon_value arg = nullptr;
    size_t argc = 1;
    if (UxpAddonApis.uxp_addon_get_cb_info(env, info, &argc, &arg, nullptr, nullptr) != addon_ok || argc != 1) {
        throw std::runtime_error("cancel requires requestId.");
    }
    return readString(env, arg);
}

struct PromiseResult {
    addon_env env = nullptr;
    addon_deferred deferred = nullptr;
    bool success = false;
    std::string value;
    std::string code;
    std::string message;
};

void deletePromiseResult(addon_task_data data) {
    delete static_cast<PromiseResult*>(data);
}

void finishPromise(addon_task_data data) {
    auto* result = static_cast<PromiseResult*>(data);
    try {
        HandlerScope scope(result->env);
        if (result->success) {
            addon_value value = nullptr;
            if (UxpAddonApis.uxp_addon_create_string_utf8(
                    result->env, result->value.c_str(), result->value.size(), &value) == addon_ok) {
                UxpAddonApis.uxp_addon_resolve_deferred(result->env, result->deferred, value);
            }
            return;
        }

        addon_value code = nullptr;
        addon_value message = nullptr;
        addon_value error = nullptr;
        UxpAddonApis.uxp_addon_create_string_utf8(
            result->env, result->code.c_str(), result->code.size(), &code);
        UxpAddonApis.uxp_addon_create_string_utf8(
            result->env, result->message.c_str(), result->message.size(), &message);
        UxpAddonApis.uxp_addon_create_error(result->env, code, message, &error);
        UxpAddonApis.uxp_addon_reject_deferred(result->env, result->deferred, error);
    } catch (...) {
    }
}

addon_value Infer(addon_env env, addon_callback_info info) {
    try {
        auto [sessionRoot, requestJson] = readInferArguments(env, info);
        addon_deferred deferred = nullptr;
        addon_value promise = nullptr;
        if (UxpAddonApis.uxp_addon_create_promise(env, &deferred, &promise) != addon_ok) {
            throw std::runtime_error("Unable to create inference promise.");
        }

        auto* result = new PromiseResult;
        result->env = env;
        result->deferred = deferred;
        try {
            std::thread([result, sessionRoot = std::move(sessionRoot), requestJson = std::move(requestJson)]() mutable {
                try {
                    result->value = Engine::instance().infer(sessionRoot, requestJson);
                    result->success = true;
                } catch (const sam31::supervisor::CancelledError& error) {
                    result->code = "CANCELLED";
                    result->message = error.what();
                } catch (const std::exception& error) {
                    result->code = "BACKEND_TECHNICAL_FAILURE";
                    result->message = error.what();
                } catch (...) {
                    result->code = "BACKEND_TECHNICAL_FAILURE";
                    result->message = "Unknown native bridge failure.";
                }
                UxpAddonApis.uxp_addon_schedule_on_javascript_queue(
                    result->env, finishPromise, result, deletePromiseResult);
            }).detach();
        } catch (...) {
            delete result;
            throw;
        }
        return promise;
    } catch (...) {
        return CreateErrorFromException(env);
    }
}

addon_value Cancel(addon_env env, addon_callback_info info) {
    try {
        const bool cancelled = Engine::instance().cancel(readCancelArgument(env, info));
        addon_value value = nullptr;
        if (UxpAddonApis.uxp_addon_get_boolean(env, cancelled, &value) != addon_ok) {
            throw std::runtime_error("Unable to create cancellation result.");
        }
        return value;
    } catch (...) {
        return CreateErrorFromException(env);
    }
}

void exportFunction(addon_env env, addon_value exports, const char* name, addon_callback callback) {
    addon_value function = nullptr;
    // Adobe's Hybrid SDK template creates native functions with an anonymous
    // function descriptor, then assigns the public name on the exports object.
    if (UxpAddonApis.uxp_addon_create_function(env, nullptr, 0, callback, nullptr, &function) != addon_ok ||
        UxpAddonApis.uxp_addon_set_named_property(env, exports, name, function) != addon_ok) {
        throw std::runtime_error(std::string("Unable to export native function: ") + name);
    }
}

addon_value Init(addon_env env, addon_value exports, const addon_apis&) {
    exportFunction(env, exports, "infer", Infer);
    exportFunction(env, exports, "cancel", Cancel);
    return exports;
}

void Terminate(addon_env) {
    Engine::instance().shutdown();
}

}  // namespace

UXP_ADDON_INIT(Init)
UXP_ADDON_TERMINATE(Terminate)
