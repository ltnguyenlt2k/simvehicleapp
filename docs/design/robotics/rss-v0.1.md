# RSS v0.1 — Robotic Signal Specification

> Quyết định: [ADR-0065](../../../analysis/adr/ADR-0065-rss-robotic-signal-specification.md). Trạng thái: **bản thiết kế**, chưa có file spec/tool. Nguồn dữ kiện robot: repo `ltnguyenlt2k/dog-ros2-simulation` @ `35c45ee` (`contracts/ros2/topics.json`, `brain.py`, `sim.py`, `capabilities.py`), đọc trực tiếp ngày 2026-11-01.

## 1. Mục tiêu

RSS làm cho robot điều mà VSS làm cho xe:

- một **tên tín hiệu ổn định, độc lập với middleware** (`Robot.Motion.Perform`, không phải `/dog1/control/request`);
- kiểu, đơn vị, giới hạn, ngữ nghĩa và **độ tươi** rõ ràng;
- workflow, compiler, runtime và GUI chỉ biết RSS;
- việc chuyển RSS sang ROS 2 thuộc về Protobus (mapping theo profile robot).

**Khác VSS (có chủ đích):**

- **Kind cho điều khiển robot.**
  - VSS chỉ có `sensor/actuator/attribute`.
  - Robot cần thêm `setpoint` (điều khiển liên tục có TTL) và `command` (lệnh có vòng đời và kết quả vật lý).
  - Robot cũng cần `event` (sự kiện rời rạc).
- **Độ tươi bắt buộc** (`maxAgeMs`) với sensor: workflow không được ra quyết định chuyển động trên dữ liệu cũ.
- **Profile**: catalog chung (`core`) + profile robot. Profile khai báo tập con được hỗ trợ và có thể *thu hẹp* giới hạn (ví dụ tốc độ tối đa dog-go2-sim), nhưng không được nới.

## 2. Định dạng

### 2.1 Nguồn (YAML, người viết)

```yaml
# robotics/rss/spec/core/Motion.rss.yaml
Robot.Motion:
  kind: branch
  description: Chuyển động thân robot.

Robot.Motion.Velocity:
  kind: setpoint
  description: Vận tốc thân mong muốn trong base_link.
  fields:
    LinearX:  { type: float64, unit: m/s,   min: -1.0, max: 1.0 }
    AngularZ: { type: float64, unit: rad/s, min: -1.5, max: 1.5 }
  ttlMs: 300
  refreshHz: 20
  safeValue: { LinearX: 0, AngularZ: 0 }

Robot.Motion.Perform:
  kind: command
  description: Thực hiện một động tác đã kiểm định.
  args:
    Name: { type: enum, values: [CROUCH, BOW, TILT, LIFT_FRONT_LEFT, JUMP, WAVE_FRONT_LEFT, SIT, STAND] }
  timeoutMs: 15000
  results: [SUCCEEDED, FAILED, REJECTED, CANCELLED, TIMED_OUT]
```

### 2.2 Catalog (JSON, máy đọc)

`rssc build` ⇒ `rss-catalog.v1.json`:

- node phẳng theo path, đã mở rộng instance (`Robot.Leg.FrontLeft.IsInContact`);
- `catalogHash = sha256(canonical JSON)`;
- tất định: cùng nguồn ⇒ cùng bytes.

Workflow ghi `catalogHash` và compiler từ chối khi catalog khác (`RF1003`).

### 2.3 Quy tắc path

| Quy tắc | Ví dụ đúng | Ví dụ sai |
|---|---|---|
| Gốc `Robot` | `Robot.Imu.AngularVelocity.Z` | `Dog.Imu…` |
| PascalCase, chữ + số, phân tách `.` | `Robot.PowerSystem.Battery.StateOfCharge` | `robot.power_system…` |
| Instance như VSS: `Leg[FrontLeft,FrontRight,RearLeft,RearRight]` | `Robot.Leg.RearLeft.Joint.Calf.Position` | `Robot.Leg.RL…` |
| Đơn vị trong metadata, không trong tên | `…Position` + `unit: rad` | `…PositionRad` |
| Boolean bắt đầu bằng `Is`/`Has` | `Robot.Safety.IsReady` | `Robot.Safety.Ready` |
| Không chứa tên middleware/topic | `Robot.Pose.Position.X` | `Robot.Odom.PoseX` |

### 2.4 Kind

| Kind | Hướng | Trường bắt buộc | Ngữ nghĩa |
|---|---|---|---|
| `branch` | — | `description` | Nhóm |
| `attribute` | robot → app | `type` | Ít đổi (id, model) |
| `sensor` | robot → app | `type`, `maxAgeMs` | Giá trị đo; mỗi mẫu có `captureTime`, `quality ∈ {OK, STALE, UNAVAILABLE}` |
| `setpoint` | app → robot | `fields`, `ttlMs`, `refreshHz`, `safeValue` | Điều khiển liên tục; hết TTL ⇒ Protobus ghi `safeValue` |
| `command` | app → robot | `args`, `timeoutMs`, `results` | Lệnh rời rạc; ACK chỉ là "đã nhận"; kết quả chỉ tính từ trạng thái vật lý thật |
| `event` | robot → app | `fields` | Sự kiện rời rạc (Stop do ai, động tác kết thúc) |

**Kiểu:** `bool, int32, int64, uint32, float32, float64, string, enum`. **Đơn vị:** tập đóng trong `robotics/rss/units.yaml`, gồm `m, m/s, m/s^2, rad, rad/s, N, N.m, V, A, %, s, ms, Hz, degC`.

## 3. Catalog `core` v0.1 + profile `dog-go2-sim`

Cột **Nguồn ROS** là mapping dự kiến của profile `dog-go2-sim`, chi tiết ở [protobus.md](protobus.md) §4. Cột **Sẵn có**:

- ✔: có ngay trên dog `main` hiện tại.
- W1/W2/W3: cần việc tương ứng ở dog R4.
- Δ: suy ra trong bridge từ dữ liệu sẵn có.

### 3.1 Identity, Connection

| Path | Kind | Kiểu/đơn vị | Nguồn ROS (`/dog1/…`) | Sẵn có |
|---|---|---|---|---|
| `Robot.Identity.Id` | attribute | string | namespace profile (`dog1`) | ✔ |
| `Robot.Identity.Model` | attribute | string | profile (`unitree-go2-sim`) | ✔ |
| `Robot.Identity.Backend` | attribute | enum SIM, REAL | `sim/state` tồn tại ⇒ `SIM` | ✔ |
| `Robot.Connection.IsOnline` | sensor | bool, maxAge 1000 | Δ: `brain/state` tươi < 1 s | Δ |
| `Robot.Connection.StateAgeMs` | sensor | float64 ms | Δ: tuổi mẫu `brain/state` | Δ |

### 3.2 Safety (Brain là trọng tài duy nhất)

| Path | Kind | Kiểu | Nguồn | Sẵn có |
|---|---|---|---|---|
| `Robot.Safety.Mode` | sensor | enum DISARMED, MANUAL, AUTO, MOTION, SAFE_STOP; maxAge 300 | `brain/state.mode` | ✔ |
| `Robot.Safety.Reason` | sensor | string | `brain/state.reason` | ✔ |
| `Robot.Safety.IsReady` | sensor | bool | `brain/state.ready` | ✔ |
| `Robot.Safety.IsArmed` | sensor | bool | Δ: mode ∈ {MANUAL, AUTO, MOTION} | Δ |
| `Robot.Safety.IsStopLatched` | sensor | bool | Δ: mode = SAFE_STOP | Δ |
| `Robot.Safety.Controller` | sensor | enum NONE, OPERATOR, WORKFLOW | `brain/state.controller` | W1 |
| `Robot.Safety.Arm` | command | — | `workflow/request {action: arm}` | W1 |
| `Robot.Safety.Disarm` | command | — | `{action: disarm}` | W1 |
| `Robot.Safety.Stop` | command (làn Stop) | — | `{action: stop}` | W1 |
| `Robot.Safety.ResetStop` | command | — | `{action: reset_stop}` | W1 |
| `Robot.Safety.StopEvent` | event | Source enum OPERATOR, WORKFLOW, WATCHDOG, SENSOR; Reason string | Δ: chuyển mode → SAFE_STOP + reason | Δ |

### 3.3 Pose, Velocity (frame `odom`, REP-103)

| Path | Kind | Đơn vị | Nguồn | Sẵn có |
|---|---|---|---|---|
| `Robot.Pose.Position.X/Y/Z` | sensor, maxAge 200 | m | `odom.pose.pose.position` (50 Hz) | ✔ |
| `Robot.Pose.Orientation.Roll/Pitch/Yaw` | sensor, maxAge 200 | rad | Δ: quaternion `odom.pose.pose.orientation` | ✔ |
| `Robot.Velocity.Linear.X/Y` | sensor, maxAge 200 | m/s | `odom.twist.twist.linear` | ✔ |
| `Robot.Velocity.Angular.Z` | sensor, maxAge 200 | rad/s | `odom.twist.twist.angular.z` | ✔ |
| `Robot.Velocity.Commanded.LinearX/AngularZ` | sensor | m/s, rad/s | `cmd_vel/safe` (sau trọng tài) | ✔ |

### 3.4 IMU

| Path | Kind | Đơn vị | Nguồn | Sẵn có |
|---|---|---|---|---|
| `Robot.Imu.AngularVelocity.X/Y/Z` | sensor, maxAge 100 | rad/s | `imu/data.angular_velocity` (100 Hz) | ✔ |
| `Robot.Imu.LinearAcceleration.X/Y/Z` | sensor, maxAge 100 | m/s^2 | `imu/data.linear_acceleration` | ✔ |
| `Robot.Imu.Orientation.Roll/Pitch/Yaw` | sensor, maxAge 100 | rad | Δ: quaternion `imu/data.orientation` | ✔ |

### 3.5 Leg (instance FrontLeft=FL, FrontRight=FR, RearLeft=RL, RearRight=RR)

| Path | Kind | Đơn vị | Nguồn | Sẵn có |
|---|---|---|---|---|
| `Robot.Leg.<L>.IsInContact` | sensor, maxAge 100 | bool | `foot_contacts.contact[i]` (50 Hz) | ✔ |
| `Robot.Leg.<L>.ContactForce` | sensor, maxAge 100 | N | `foot_contacts.normal_force_n[i]` | ✔ |
| `Robot.Leg.<L>.Joint.<J>.Position` (J = Hip, Thigh, Calf) | sensor, maxAge 100 | rad | `joint_states.position` theo tên `<FL…>_<hip/thigh/calf>_joint` | ✔ |
| `Robot.Leg.<L>.Joint.<J>.Velocity` | sensor | rad/s | `joint_states.velocity` | ✔ |
| `Robot.Leg.<L>.Joint.<J>.Effort` | sensor | N.m | `joint_states.effort` | ✔ |

4 chân × (2 + 3 × 3) = 44 node. Giá trị khớp chỉ để quan sát và điều kiện; **RSS v0.1 không có lệnh khớp/motor** (dog cấm `LowCmd`/motor từ ngoài; luật ADR-0069).

### 3.6 PowerSystem

| Path | Kind | Đơn vị | Nguồn | Sẵn có |
|---|---|---|---|---|
| `Robot.PowerSystem.Battery.StateOfCharge` | sensor, maxAge 3000 | % | `battery_state.percentage × 100` | ✔ (hằng 92 %), động: W3 |
| `Robot.PowerSystem.Battery.Voltage` | sensor | V | `battery_state.voltage` | ✔ (hằng 28,8 V) |
| `Robot.PowerSystem.Battery.IsPresent` | sensor | bool | `battery_state.present` | ✔ |

### 3.7 Motion (động tác có tên)

| Path | Kind | Kiểu | Nguồn | Sẵn có |
|---|---|---|---|---|
| `Robot.Motion.Velocity` | setpoint | LinearX m/s [-0.5, 0.5] · AngularZ rad/s [-0.65, 0.65]; ttl 300 ms; refresh 20 Hz | `workflow/request {action: manual, linear, angular}` | W1 |
| `Robot.Motion.Perform` | command | Name ∈ CROUCH, BOW, TILT, LIFT_FRONT_LEFT, JUMP (✔); WAVE_FRONT_LEFT, SIT, STAND (W2) | `{action: motion, motion_name}`; kết quả `motion/state` | W1/W2 |
| `Robot.Motion.Cancel` | command | — | `{action: motion_cancel}` | W1 |
| `Robot.Motion.State.Phase` | sensor | enum IDLE, DISPATCHED, RUNNING, RECOVERING, SUCCEEDED, CANCELLED, FAILED, REJECTED | `brain/state.motion.phase` / `motion/state` | ✔ |
| `Robot.Motion.State.Name` | sensor | string | `brain/state.motion.name` | ✔ |
| `Robot.Motion.IsBodyBusy` | sensor | bool | Δ: `brain/state.active_motion_id` ≠ null | Δ |

Giới hạn `[-0.5, 0.5]` / `[-0.65, 0.65]` là giới hạn Brain đang kẹp. Profile dog phải khai bằng hoặc hẹp hơn; catalog `core` dùng biên rộng hơn.

**Map tên động tác:**

| RSS | ROS |
|---|---|
| `CROUCH` | `crouch` |
| `BOW` | `bow` |
| `TILT` | `tilt` |
| `LIFT_FRONT_LEFT` | `lift_fl` |
| `JUMP` | `jump` |
| `WAVE_FRONT_LEFT` | `wave_fl` (dog ADR-0020) |
| `SIT` | `sit` (dog ADR-0020) |
| `STAND` | `stand` (dog ADR-0020) |

### 3.8 Navigation (Nav2 + SLAM của dog; frame `map`)

| Path | Kind | Kiểu | Nguồn | Sẵn có |
|---|---|---|---|---|
| `Robot.Navigation.GoTo` | command | X, Y (m, frame map); timeout 60 s | `{action: goal, goal: [x,y], goal_frame: map}`; kết quả `brain/state.mission` | W1 |
| `Robot.Navigation.FollowRoute` | command | Waypoints: tối đa 20 × (X, Y) m | `{action: route, waypoints}` | W1 |
| `Robot.Navigation.Cancel` | command | — | `{action: cancel}` | W1 |
| `Robot.Navigation.Mission.State` | sensor | enum IDLE, RUNNING, SUCCEEDED, FAILED, REJECTED, CANCELLED | `brain/state.mission` | ✔ |
| `Robot.Navigation.Route.Completed` / `.Total` | sensor | uint32 | `brain/state.route_completed/route_total` | ✔ |
| `Robot.Navigation.IsReady` | sensor | bool | `brain/state.nav_ready` | ✔ |

### 3.9 Perception, Obstacle

| Path | Kind | Kiểu | Nguồn | Sẵn có |
|---|---|---|---|---|
| `Robot.Perception.Marker.IsDetected` | sensor, maxAge 500 | bool | Δ: `perception/detections` có `class_id = red_sim_marker` | ✔ |
| `Robot.Perception.Marker.Count` | sensor | uint32 | Δ: số detection | ✔ |
| `Robot.Perception.Marker.BearingDeg`… | — | — | **không làm v0.1** (cần calibration; backlog) | — |
| `Robot.Obstacle.MinRange` | sensor, maxAge 300 | m | Δ: min hữu hạn của `scan.ranges` | ✔ |

Marker đỏ là marker mô phỏng, **không phải nhận diện người** (giới hạn ghi trong dog `perception/state`).

### 3.10 Simulation (chỉ profile SIM)

| Path | Kind | Kiểu | Nguồn | Sẵn có |
|---|---|---|---|---|
| `Robot.Simulation.SceneId` | sensor | enum courtyard, warehouse, terrain_lab | `brain/state.scene_id` | ✔ |
| `Robot.Simulation.Battery.Drain` | command | Rate %/min, hoặc SetLevel % | sim stimulus | W3 |

**Tổng v0.1 (dog-go2-sim):**

- **Khoảng 100 node lá** sau khi mở rộng instance.
- **8 command + 1 setpoint**.
- **Không truyền ảnh/point cloud** qua RSS; chỉ tín hiệu dẫn xuất (ADR-0070).

## 4. Phiên bản và tương thích

- `rss: "0.1"`; thêm node là **minor**, đổi kiểu/đơn vị/xoá là **major** + ADR.
- Mỗi workflow ghi `rss.version` + `catalogHash` + `profile`. Catalog khác ⇒ GUI đề nghị *migrate* (so sánh path), không âm thầm đổi.
- Tài liệu tham chiếu sinh tự động: `rssc docs` ⇒ `docs/reference/rss/*.md` (M22).

## 5. Kiểm tra (M22 gate)

- **Schema `rss-spec.v1` cho nguồn và `rss-catalog.v1` cho đầu ra:** test chấp nhận/từ chối, gồm tên sai, đơn vị lạ, `setpoint` thiếu `safeValue`, `sensor` thiếu `maxAgeMs`.
- **`rssc build` hai lần:** bytes giống hệt nhau.
- **Đối chiếu profile `dog-go2-sim` với `contracts/ros2/topics.json` của dog (commit được pin):** mọi topic nguồn tồn tại, đúng type.
- **Đối chiếu giới hạn profile với hằng số trong `brain.py`:** đã đọc ngày 2026-11-01, gồm manual 0.5 m/s, 0.65 rad/s và tối đa 20 waypoint.
