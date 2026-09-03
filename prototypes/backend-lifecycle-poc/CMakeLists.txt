cmake_minimum_required(VERSION 3.21)
project(sam31_backend_lifecycle_poc LANGUAGES CXX)

add_executable(sam31_lifecycle_poc src/main.cpp)
target_compile_features(sam31_lifecycle_poc PRIVATE cxx_std_20)
target_compile_definitions(sam31_lifecycle_poc PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(sam31_lifecycle_poc PRIVATE ws2_32 bcrypt)

if(MSVC)
  target_compile_options(sam31_lifecycle_poc PRIVATE /W4 /permissive- /EHsc)
endif()

enable_testing()
add_test(NAME lifecycle_selftest COMMAND sam31_lifecycle_poc --selftest)
set_tests_properties(lifecycle_selftest PROPERTIES TIMEOUT 20)
