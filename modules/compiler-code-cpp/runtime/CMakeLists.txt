# Copyright (c) 2026 SimVehicleApp contributors
# SPDX-License-Identifier: Apache-2.0
#
# simvehicleapp-runtime-cpp (ADR-0021). Two ways to build it:
#  - inside a generated vehicle app: app/src/CMakeLists.txt adds this directory (vendored copy,
#    nlohmann_json from the template's Conan deps, SV_RT_VELOCITAS=ON for the SDK adapter);
#  - standalone (CI, conformance): `cmake -S runtime -B build && cmake --build build && ctest`.
cmake_minimum_required(VERSION 3.16)
project(simvehicleapp-runtime-cpp LANGUAGES CXX)

file(STRINGS "${CMAKE_CURRENT_SOURCE_DIR}/VERSION" SV_RUNTIME_VERSION LIMIT_COUNT 1)

option(SV_RT_VELOCITAS "Build the Velocitas SDK adapter (VelocitasVehicleAccess, AppBase)" OFF)
option(SV_RT_TESTS "Build the runtime unit tests" ${PROJECT_IS_TOP_LEVEL})

if(NOT DEFINED CMAKE_CXX_STANDARD)
  set(CMAKE_CXX_STANDARD 17)
endif()
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
if(NOT TARGET nlohmann_json::nlohmann_json)
  find_package(nlohmann_json 3.11 QUIET)
endif()
if(NOT TARGET nlohmann_json::nlohmann_json)
  FetchContent_Declare(nlohmann_json
    URL https://github.com/nlohmann/json/releases/download/v3.11.3/json.tar.xz
    URL_HASH SHA256=d6c65aca6b1ed68e7a182f4757257b107ae403032760ed6ef121c9d55e81757d)
  FetchContent_MakeAvailable(nlohmann_json)
endif()

# Same IEEE results as the simulator and the other backends (IR_SPEC `unit.convert`: no FMA).
set(SV_RT_COMPILE_OPTIONS -ffp-contract=off)

add_library(simvehicleapp-runtime STATIC
  src/Value.cpp
  src/Strand.cpp
  src/Runtime.cpp
)
target_include_directories(simvehicleapp-runtime PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)
target_link_libraries(simvehicleapp-runtime PUBLIC nlohmann_json::nlohmann_json)
target_compile_options(simvehicleapp-runtime PUBLIC ${SV_RT_COMPILE_OPTIONS})
target_compile_definitions(simvehicleapp-runtime PUBLIC SV_RUNTIME_VERSION="${SV_RUNTIME_VERSION}")
find_package(Threads REQUIRED)
target_link_libraries(simvehicleapp-runtime PUBLIC Threads::Threads)

add_library(simvehicleapp-runtime-testing STATIC src/Testing.cpp)
target_link_libraries(simvehicleapp-runtime-testing PUBLIC simvehicleapp-runtime)

if(SV_RT_VELOCITAS)
  add_library(simvehicleapp-runtime-velocitas STATIC src/Velocitas.cpp)
  target_link_libraries(simvehicleapp-runtime-velocitas PUBLIC
    simvehicleapp-runtime vehicle-app-sdk::vehicle-app-sdk)
endif()

if(SV_RT_TESTS)
  enable_testing()
  if(DEFINED ENV{SV_GOOGLETEST_SRC})
    # Offline (toolchain image): the archive the template pins, pre-extracted.
    FetchContent_Declare(googletest SOURCE_DIR $ENV{SV_GOOGLETEST_SRC})
  else()
    FetchContent_Declare(googletest
      URL https://github.com/google/googletest/archive/609281088cfefc76f9d0ce82e1ff6c30cc3591e5.zip
      URL_HASH SHA256=5cf189eb6847b4f8fc603a3ffff3b0771c08eec7dd4bd961bfd45477dd13eb73)
  endif()
  set(gtest_force_shared_crt ON CACHE BOOL "" FORCE)
  set(INSTALL_GTEST OFF CACHE BOOL "" FORCE)
  FetchContent_MakeAvailable(googletest)

  add_executable(runtime_test
    tests/ValueTest.cpp
    tests/StrandTest.cpp
    tests/RuntimeTest.cpp
  )
  target_link_libraries(runtime_test PRIVATE simvehicleapp-runtime-testing gtest_main)
  target_compile_options(runtime_test PRIVATE -Wall -Wextra)
  get_filename_component(SV_FIXTURES "${CMAKE_CURRENT_SOURCE_DIR}/../../simvehicleapp-contracts/fixtures" ABSOLUTE)
  target_compile_definitions(runtime_test PRIVATE SV_FIXTURES_DIR="${SV_FIXTURES}/")
  include(GoogleTest)
  gtest_discover_tests(runtime_test DISCOVERY_MODE PRE_TEST)
endif()
