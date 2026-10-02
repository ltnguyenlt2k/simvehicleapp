# SimVehicleApp spike S-4: mirror actuator target -> current value (what a real provider does).
from lib.dsl import create_behavior, create_event_trigger, create_set_action, mock_datapoint
from lib.trigger import EventType

for path, initial in [
    ("Vehicle.Body.Lights.Hazard.IsSignaling", False),
    ("Vehicle.Body.Windshield.Front.Wiping.Mode", "OFF"),
]:
    mock_datapoint(
        path=path,
        initial_value=initial,
        behaviors=[
            create_behavior(
                trigger=create_event_trigger(EventType.ACTUATOR_TARGET),
                action=create_set_action("$event.value"),
            )
        ],
    )
