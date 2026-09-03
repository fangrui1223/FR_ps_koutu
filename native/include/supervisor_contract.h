#pragma once

#include <string_view>

namespace sam31::supervisor {

inline constexpr std::string_view kAddonName = "sam31-supervisor.uxpaddon";
inline constexpr std::string_view kInferExport = "infer";
inline constexpr std::string_view kCancelExport = "cancel";
inline constexpr std::string_view kProtocolVersion = "1";

// JavaScript contract:
//   Promise<string> infer(string sessionRootNativePath, string requestJson)
//   Promise<boolean> cancel(string requestId)
//
// `infer` owns backend discovery/start/restart. It retries exactly once only for
// transport/backend technical failures and returns the backend JSON unchanged.
// Validation/no-object errors are returned without restarting the process.

} // namespace sam31::supervisor
