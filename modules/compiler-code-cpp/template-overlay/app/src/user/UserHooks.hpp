// Your code: SimVehicleApp creates this file once and never changes it again.
#ifndef SIMVEHICLEAPP_USER_USERHOOKS_HPP
#define SIMVEHICLEAPP_USER_USERHOOKS_HPP

namespace simvehicleapp::user {

/** Called once when the app has connected to the databroker, before the workflows start. */
void onAppStart();

/** Called when the app is asked to stop. */
void onAppStop();

} // namespace simvehicleapp::user

#endif // SIMVEHICLEAPP_USER_USERHOOKS_HPP
