// Copyright (c) 2026 SimVehicleApp contributors
// SPDX-License-Identifier: Apache-2.0
// User hooks of the app: yours to edit, SynCode never touches this file.
#pragma once

namespace simvehicleapp::user {
/** Runs once when the app starts, before the workflows react to signals. */
void onAppStart();
/** Runs once when the app stops. */
void onAppStop();
} // namespace simvehicleapp::user
