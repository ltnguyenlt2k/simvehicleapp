# SimVehicleApp WebAssembly app in C++ (ADR-0061): a wasm32-wasip1 reactor for sv-wasm-host (contracts
# abi/sv-wasm-abi.v1.md). Configure with the wasi-sdk toolchain:
#   cmake -S app -B build -DCMAKE_TOOLCHAIN_FILE=$WASI_SDK_PATH/share/cmake/wasi-sdk.cmake -DCMAKE_BUILD_TYPE=Release
#   cmake --build build        ⇒ build/app.wasm
cmake_minimum_required(VERSION 3.16)
project(SimVehicleAppWasm CXX)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(nlohmann_json 3.11 REQUIRED)
include(${CMAKE_CURRENT_LIST_DIR}/src/generated/generated.cmake)
set(SV_RT ${CMAKE_CURRENT_LIST_DIR}/src/simvehicleapp-runtime)

add_executable(app
  ${SV_GENERATED_SOURCES}
  src/user/UserHooks.cpp
  ${SV_RT}/src/Runtime.cpp
  ${SV_RT}/src/Value.cpp
  ${SV_RT}/src/Strand.cpp
  ${SV_RT}/src/Testing.cpp
  ${SV_RT}/src/Wasm.cpp
)
set_target_properties(app PROPERTIES SUFFIX ".wasm")
target_include_directories(app PRIVATE src src/generated ${SV_RT}/include)
target_link_libraries(app PRIVATE nlohmann_json::nlohmann_json)
# The runtime's EvalError uses exceptions: WebAssembly exception handling (new EH), unwinder linked in (M20-T01).
target_compile_options(app PRIVATE -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false)
target_link_options(app PRIVATE -mexec-model=reactor -fwasm-exceptions -mllvm -wasm-use-legacy-eh=false -lunwind)
