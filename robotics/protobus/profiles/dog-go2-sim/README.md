# dog-control/1 mapping increment

mapping.json maps 31 observation paths from IMU, odometry, battery, Brain/scene
state and scan. Frames and units remain the RSS catalog's odom/SI declarations;
no simulation ground-truth pose is substituted for odometry. Fixture provenance
is in ../../fixtures/dog-go2-sim/provenance.json.

At the M22 recorded snapshot, 30 mapped values are available; Battery.IsCharging
is NONE because ROS power_supply_status is UNKNOWN. SOC/voltage/current are the
dog simulator's declared synthetic battery fields, not measured hardware energy.
Unknown enum, unavailable IMU covariance (-1), invalid quaternion/range, missing
field and nonfinite scalar yield NONE, never an invented zero. Repeated or older
captures do not renew data. Mapping work runs on the provider asyncio owner loop;
ROS callbacks use a bounded latest-message mailbox per topic.

The profile keeps allowRemoteArm=false. Control declarations are interfaces for
the next adapter task and do not execute robot commands. Leg/joint arrays and
marker signals remain unmapped until their named-order/detector contract is
validated by that adapter; broker observations remain NONE for missing sources.
Live mapping accuracy, Brain ownership, command correlation and stop behavior
still require M24's actual dog simulation gate.
