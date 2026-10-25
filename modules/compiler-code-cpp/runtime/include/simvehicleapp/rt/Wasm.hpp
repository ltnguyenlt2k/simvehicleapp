// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0
#ifndef SIMVEHICLEAPP_RT_WASM_HPP
#define SIMVEHICLEAPP_RT_WASM_HPP

#include "simvehicleapp/rt/Runtime.hpp"

#include <functional>
#include <string>
#include <utility>
#include <vector>

/**
 * The runtime as a WebAssembly guest (ADR-0061, contracts `abi/sv-wasm-abi.v1.md`): `src/Wasm.cpp` implements the
 * `sv_*` exports over the `sv.*` imports of `sv-wasm-host`; a generated app only registers itself.
 */
namespace simvehicleapp::rt::wasm {

struct App {
    std::string name;
    TraceLevel level = TraceLevel::Node;
    /** The workflows (generated): id and `bind`, in declaration order. Test cases bind only their workflow. */
    std::vector<std::pair<std::string, std::function<void(Runtime&)>>> workflows;
    /** User hooks (`app/src/user/UserHooks.*`). */
    std::function<void()> onAppStart = [] {};
    std::function<void()> onAppStop = [] {};
};

/** Called once by the generated `MainWasm.cpp` from a static initializer (run by the reactor's `_initialize`). */
bool registerApp(App app);

} // namespace simvehicleapp::rt::wasm

#endif // SIMVEHICLEAPP_RT_WASM_HPP
