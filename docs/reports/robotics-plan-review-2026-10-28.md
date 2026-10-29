# Review kế hoạch Robotics M22–M27 — 2026-10-28

## Kết luận và phạm vi

**Hướng kiến trúc hợp lý; chưa nên chốt toàn bộ ADR để triển khai nguyên trạng.** Có thể giữ RSS → Protobus → adapter ROS 2 và RobotFlow → Python/rfrt, nhưng cần đóng các khoảng trống P1 dưới đây trước khi đóng băng contracts. Đây là review thiết kế, không phải bằng chứng chạy, nghiệm thu milestone hay commissioning hardware.

Đã đọc design M22, ADR-0064…0068, các phase M22…M27, AGENTS và ROADMAP tại simvehicleapp HEAD `105f7a91c2090d792c4ec9023dd953a5bcd7587e`. Chưa có thư mục robotics/ tại thời điểm review. Đối chiếu thêm source dog trong workspace Windows HEAD `25b4bfada838b25ab93cf73c658c356a8ab90ef9`; bản này khác pin dog `9adea9be…` của kế hoạch. Các khác biệt source hiện tại là yêu cầu kiểm lại compatibility, không tự động phủ nhận bản pin.

Điểm tốt: tách stack xe/robot rõ, không LLM trong compiler, setpoint struct nguyên tử có TTL, ACK tách khỏi kết quả thực, app không gọi ROS trực tiếp, mock và live dùng cùng app, có DDS/envelope/performance spikes và fault tests, REAL ngoài v0.1.

## Findings cần xử lý

### R01 — P1: Simulate/Test chưa có ranh giới ngăn truy cập live

**Nguồn:** design §8 dòng 460–464; ADR-0068 Decision 5.

ADR nói broker/network khác nên Simulate/Test không thể nối robot. Bảng triển khai lại đặt runner, broker sim và broker live trên cùng sr-bus. Đổi endpoint hoặc lỗi điều phối có thể đưa app test tới broker live. Network internal chỉ hạn chế kết nối ra ngoài mạng, không chặn các service cùng mạng.

**Đề xuất:** sr-sim-bus và sr-live-bus riêng; runner sim/live là service riêng, endpoint cố định theo mode; API xác thực mode/robot/profile, broker kiểm quyền provider/client. Bridge chỉ gắn live-bus và mạng dog. API có thể là điểm nối cả hai nhưng phải kiểm quyền ở mỗi thao tác.

**Gate:** từ runner sim, thử kết nối live broker và publish lệnh phải thất bại; không có request trên ROS khi chạy Test, kể cả đổi endpoint trong input.

### R02 — P1: STOP ưu tiên trên hàng đợi ứng dụng chưa đủ thành bảo đảm đầu cuối

**Nguồn:** ADR-0066 Decision 1–2; design §5.1–5.2.

Telemetry, command và STOP dùng một Provider.Attach stream. Tuyên bố bỏ hàng đợi chưa định nghĩa khi stream nghẽn, provider chậm/offline hoặc broker chết. Flow control của gRPC có thể trì hoãn việc gửi. STOP hiện độc lập với app nhưng vẫn phụ thuộc API/broker/bridge.

**Đề xuất:** chốt đường STOP có queue hữu hạn/ưu tiên hoặc kênh điều khiển riêng; phân biệt requested, dispatched, robot-confirmed. STOP thu hồi quyền chuyển động, vô hiệu lệnh chờ và không để lệnh cũ chạy sau reset. Khi provider mất, UI báo chưa xác nhận thay vì báo robot đã dừng.

**Gate:** đo latency tới control/request và tới cmd_vel/safe dưới tải, slow consumer, mất broker/provider. Giữ rõ đây là software STOP, không E-stop vật lý.

### R03 — P1: Lease chưa giải quyết tranh chấp trong cùng app và chủ điều khiển phía dog

**Nguồn:** ADR-0066 Decision 2.6; ADR-0067 parallel/Hold; design RW-B/RW-D.

Một lease mỗi robot chỉ phân biệt app, không ngăn hai behavior cùng app đồng thời Hold vận tốc, GoTo hoặc Perform. Brain còn có thể nhận lệnh từ Robot Zoo ngoài Protobus; lease của broker chưa bao phủ writer đó. Manual hiện tại trong source dog có thể hủy AUTO/MOTION.

**Đề xuất:** bảng tài nguyên motion/navigation/body; chính sách reject/cancel/preempt và thứ tự release. Chốt chế độ độc quyền với GUI dog hoặc thực thi quyền sở hữu tại biên robot; không tuyên bố lease Protobus là độc quyền toàn robot khi chưa có cơ chế đó.

**Gate:** hai nhánh Hold/GoTo/Perform tranh chấp, lệnh GUI đồng thời và STOP phải cho kết quả xác định; không có nguồn điều khiển tiếp tục chạy ngoài ý định.

### R04 — P1: Thiếu clock domains, deadline và chống phát lại sau reconnect

**Nguồn:** ADR-0066 samples/TTL/lease; ADR-0067 BusClient tự reconnect; design §5.3.

issued_at_ns dùng ROS sim time là đúng cho envelope dog, nhưng TTL/lease/watchdog không được phụ thuộc clock có thể pause hoặc reset. Chưa quy định broker restart epoch, provider session, sequence, fencing lease và xử lý lệnh đã gửi nhưng mất ACK.

**Đề xuất:** monotonic clock cho an toàn trong từng process; truyền deadline còn lại với quy tắc tuổi message rõ. ROS time chỉ cho capture/envelope; ghi clock domain và session/scene epoch. Bridge có hạn cục bộ khi mất broker; reconnect không replay Arm/GoTo/Perform. Chốt executionId ↔ request_id ↔ motion_id và nhận diện kết quả cũ.

**Gate:** pause/reset clock, network partition hai chiều, broker/provider restart, ACK đến muộn, command duplicate. Sau phục hồi không tự tiếp tục chuyển động; cần phiên điều khiển mới theo chính sách được duyệt.

### R05 — P1: Hợp đồng freshness và state machine chưa đủ rõ để compiler/runtime dùng an toàn

**Nguồn:** ADR-0065 Decision 2; ADR-0066 Subscribe; ADR-0067 triggers.

Subscribe chỉ on-change có thể không báo OK → STALE khi giá trị không đổi. Chưa rõ snapshot lúc subscribe, quality đổi, dữ liệu NONE/NaN/Inf, sample out-of-order, queue overflow. Sơ đồ vòng đời dùng ký hiệu tuyến tính dễ hiểu nhầm REJECTED vẫn đi tiếp RUNNING; chưa có bảng chuyển trạng thái và tính cuối cùng của terminal state.

**Đề xuất:** gửi snapshot + quality transitions; event/sample có sequence và nguồn thời gian; queue hữu hạn và coalesce telemetry. Biểu thức đọc STALE/NONE phải có semantics rõ; không ngầm dùng giá trị cũ cho motion. State machine ghi transitions hợp lệ, terminal bất biến, timeout/cancel race. Status.* là snapshot của execution nào phải rõ; trace lệnh dùng executionId.

**Gate:** giá trị không đổi rồi mất sensor vẫn phát STALE; terminal muộn sau TIMED_OUT không biến thành SUCCEEDED; workflow không điều khiển dựa trên sensor hết hạn.

### R06 — P2: timeScale và parity đang được mô tả quá mạnh

**Nguồn:** design §3, §5.4, §7; ADR-0067 Consequences; ADR-0068 scenario.v1.

Cùng app giúp giảm hai đường thực thi nhưng không chứng minh tương đương hành vi giữa mock và MuJoCo. Nếu chỉ tăng tốc mock, wait/forMs/timeout của rfrt và TTL broker vẫn chạy thời gian thực, làm Test sai thời gian.

**Đề xuất:** v0.1 giới hạn timeScale=1 cho gate, hoặc thiết kế clock trừu tượng dùng chung cho runtime/mock/scenario với safety clock tách riêng. Định nghĩa parity là contract/trace tại những điểm có kiểm chứng, không parity vật lý. Mỗi scenario reset sensor, pose, mode, commands, lease và seed; không để Test ảnh hưởng phiên Simulate khác.

**Gate:** cùng scenario ở các tốc độ được hỗ trợ cho cùng thứ tự/số lượng sự kiện; nếu chưa hỗ trợ thì UI và schema từ chối timeScale khác 1.

### R07 — P2: Baseline dog và template chưa có điều kiện đầu/cuối đủ dùng

**Nguồn:** design §2.1, §7; M24-T03; ADR-0065 FollowRoute.

Pin dog là bản cũ hơn source workspace hiện tại; cần chọn rõ bản được hỗ trợ. Source hiện tại có boot_id, scene_epoch, scene_ready và map_generation. Route nhận waypoints trong request; RSS FollowRoute nhận RouteId nhưng chưa định nghĩa kho route/resolve và version. RW-A/RW-C thiếu Arm/setup; RW-D hủy nhiệm vụ rồi crouch nhưng chưa chờ recovery/MANUAL. Chuỗi tuần tra rồi chào còn phụ thuộc giới hạn vùng thực hiện động tác.

**Đề xuất:** compatibility manifest gồm dog SHA, image digest, envelope, mapping/catalog/profile hash. Quy định scene/map/frame readiness và invalidation. Viết preconditions/postconditions, setup, reset, timeout và nhánh lỗi cho từng RW; chốt route registry hoặc truyền waypoint có kiểu. Đọc capability từ backend thay vì hứa mọi hành vi thành công trong mọi vị trí.

**Gate:** RW-A…D chạy riêng từ DISARMED với setup tường minh; chọn lại scene hoặc frame không hợp lệ làm lệnh bị từ chối đúng lý do.

### R08 — P2: Thứ tự gate và đường build CI còn mâu thuẫn

**Nguồn:** M22-T07, M23-T06, M24-T01, M25-T08/gate, M26 gate; design §5.4, RR6; ADR-0068 Decision 9.

- M23 mock phụ thuộc số đo S-R3 tại M22 nhưng design §5.4 lại lấy số đo ở M24: chọn M22 để tránh phụ thuộc ngược.
- M25 nói độc lập M24, nhưng gate/headless live cần M24: tách gate compiler/mock và gate tích hợp live; chỉ gate sau mới cần M24.
- M26 có gate UI nhưng ADR-0068 §9 yêu cầu full @live/video/docs trước tick; M27 mới thực hiện các việc này: phân biệt gate kỹ thuật M26 và nghiệm thu sản phẩm M27.
- M24-T01 yêu cầu build CI từ repo private, RR6 vẫn chưa có quyền: cần source package dog_interfaces đã pin/checksum/license hoặc quyền CI được cấp trước.
- CI lọc robotics/** sẽ bỏ qua thay đổi chính robotics.yml nếu không thêm path đó.
- C-R01…C-R12 chưa có bảng 12 ID riêng dù dùng tỷ lệ 12/12; cần test ID → requirement → assertion → evidence.

**Gate:** dependency graph không có cạnh ngược; build offline/từ source được cấp quyền thành công; mọi conformance case có ID và tiêu chí kiểm chứng.

## Điểm bổ sung trước khi mở rộng

Runner process con + rlimit không tương đương sandbox mạng từng app. Với cùng sr-bus, app vẫn thấy mọi service trên đó. Cần chốt chỉ chạy source compiler sinh ra, chặn path traversal/symlink/file set vượt giới hạn, đọc filesystem tối thiểu và dọn cả process group. Đưa spike S-R6 lên trước đầu tư UI.

RSS nên tách semantic chung khỏi capability/limits theo profile: hiện min/max vận tốc và enum động tác còn đặc thù Go2. Ghi rõ RSS là đặc tả nội bộ đề xuất, chưa phải chuẩn robotics được công nhận.

Không tự động đổi Python sang Rust chỉ vì một benchmark fail: trước hết giữ cấu hình máy/tải, đo event loop, serialization, batching và backpressure; ADR đổi ngôn ngữ chỉ khi đã xác định nguyên nhân.

## Thứ tự sửa kế hoạch đề xuất — chờ PO xác nhận

1. Chốt compatibility dog và đường build CI; cập nhật schema/protocol cho R01…R05.
2. Đưa kiểm chứng stop/lease/reconnect và spike runner lên sớm.
3. Giữ M22 → M23; hoàn thành một lát cắt headless nhỏ: sensor → workflow → lệnh BOW → trạng thái thật → STOP.
4. M24 và phần compiler/mock của M25 có thể làm song song; nghiệm thu live sau khi cả hai gate kỹ thuật PASS.
5. M26 UI, rồi M27 full live/video/docs/soak. V0.1 timeScale=1 nếu chưa có clock design.
6. Sau khi sửa mâu thuẫn mới xem xét Accepted ADR-0064…0068. Hardware/Jetson vẫn ngoài phạm vi, gate mở.

Không chạy build/test hay điều khiển robot trong review này; không có thay đổi code sản phẩm. Các đề xuất trên chưa thay Decision của ADR và chưa đánh dấu task triển khai hoàn thành.

## Tham chiếu chính thức kiểm tra bổ sung

- Docker: https://docs.docker.com/compose/how-tos/networking/ — các container cùng network có thể liên lạc; internal không phải quyền truy cập theo mode.
- gRPC: https://grpc.io/docs/guides/flow-control/ — flow control có thể trì hoãn gửi stream; cần kiểm chứng STOP đầu cuối trong thiết kế này.
