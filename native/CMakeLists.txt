cmake_minimum_required(VERSION 3.21)
project(sam31_supervisor_uxpaddon LANGUAGES CXX)

set(UXP_HYBRID_SDK_ROOT "" CACHE PATH "Path to the unpacked Adobe UXP Hybrid Plugin SDK")
if(NOT UXP_HYBRID_SDK_ROOT)
  message(FATAL_ERROR "UXP_HYBRID_SDK_ROOT is required. Download the SDK from Adobe Developer Console.")
endif()

set(SAM31_BACKEND_PYTHON "" CACHE FILEPATH "Development Python runtime (explicit opt-in)")
get_filename_component(SAM31_REPO_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/.." ABSOLUTE)
set(SAM31_BACKEND_ROOT "${SAM31_REPO_ROOT}/backend" CACHE PATH "Development backend package root")
set(SAM31_MODEL_CHECKPOINT "${SAM31_REPO_ROOT}/models/sam3.1_multiplex_fp16.safetensors" CACHE FILEPATH "SAM 3.1 checkpoint")
set(SAM31_OFFICIAL_SAM3_ROOT "${SAM31_REPO_ROOT}/work/sam3-official" CACHE PATH "Official Meta SAM 3 checkout")
option(SAM31_BACKEND_MOCK_ALPHA "Launch the alpha-only test adapter" OFF)
option(SAM31_ALLOW_DEV_FALLBACK "Allow compiled development runtime paths when no installer config exists" OFF)

file(TO_NATIVE_PATH "${SAM31_BACKEND_PYTHON}" SAM31_BACKEND_PYTHON_NATIVE)
file(TO_NATIVE_PATH "${SAM31_BACKEND_ROOT}" SAM31_BACKEND_ROOT_NATIVE)
file(TO_NATIVE_PATH "${SAM31_MODEL_CHECKPOINT}" SAM31_MODEL_CHECKPOINT_NATIVE)
file(TO_NATIVE_PATH "${SAM31_OFFICIAL_SAM3_ROOT}" SAM31_OFFICIAL_SAM3_ROOT_NATIVE)
configure_file(include/build_config.h.in generated/build_config.h @ONLY)

add_library(sam31_supervisor SHARED
  src/module.cpp
  src/runtime_config.cpp
  src/supervisor.cpp
  "${UXP_HYBRID_SDK_ROOT}/src/utilities/UxpAddon.cpp"
)
target_compile_features(sam31_supervisor PRIVATE cxx_std_20)
target_compile_definitions(sam31_supervisor PRIVATE
  UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX _WINDOWS _USRDLL
)
target_include_directories(sam31_supervisor PRIVATE
  "${UXP_HYBRID_SDK_ROOT}/src/api"
  "${UXP_HYBRID_SDK_ROOT}/src/utilities"
  "${CMAKE_CURRENT_SOURCE_DIR}/include"
  "${CMAKE_CURRENT_BINARY_DIR}/generated"
)
target_link_libraries(sam31_supervisor PRIVATE ws2_32 bcrypt)

if(MSVC)
  target_compile_options(sam31_supervisor PRIVATE /W4 /permissive- /EHsc /utf-8)
  target_link_options(sam31_supervisor PRIVATE /SUBSYSTEM:WINDOWS /INCREMENTAL:NO)
endif()

set_target_properties(sam31_supervisor PROPERTIES
  OUTPUT_NAME "sam31-supervisor"
  PREFIX ""
  SUFFIX ".uxpaddon"
)

include(CTest)
if(BUILD_TESTING)
  add_executable(sam31_supervisor_smoke
    tests/supervisor_smoke.cpp
    src/runtime_config.cpp
    src/supervisor.cpp
  )
  target_compile_features(sam31_supervisor_smoke PRIVATE cxx_std_20)
  target_compile_definitions(sam31_supervisor_smoke PRIVATE
    UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX
  )
  target_include_directories(sam31_supervisor_smoke PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/include"
    "${CMAKE_CURRENT_BINARY_DIR}/generated"
  )
  target_link_libraries(sam31_supervisor_smoke PRIVATE ws2_32 bcrypt)
  if(MSVC)
    target_compile_options(sam31_supervisor_smoke PRIVATE /W4 /permissive- /EHsc /utf-8)
  endif()
  add_test(NAME sam31_supervisor_smoke COMMAND sam31_supervisor_smoke)

  add_executable(sam31_runtime_config_tests
    tests/runtime_config_tests.cpp
    src/runtime_config.cpp
  )
  target_compile_features(sam31_runtime_config_tests PRIVATE cxx_std_20)
  target_compile_definitions(sam31_runtime_config_tests PRIVATE
    UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX
  )
  target_include_directories(sam31_runtime_config_tests PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/include"
    "${CMAKE_CURRENT_BINARY_DIR}/generated"
  )
  if(MSVC)
    target_compile_options(sam31_runtime_config_tests PRIVATE /W4 /permissive- /EHsc /utf-8)
  endif()
  add_test(NAME sam31_runtime_config_tests COMMAND sam31_runtime_config_tests)
endif()
