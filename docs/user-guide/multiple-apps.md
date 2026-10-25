# Nhiều vehicle app nói chuyện với nhau (standalone services)

> [ADR-0044](../../analysis/adr/ADR-0044-standalone-service-apps.md) §1, M21 D9.

Một vehicle app gồm mọi workflow của nó và chạy thành **một** tiến trình. Muốn tách một chức năng thành service riêng (chạy, build, deploy riêng), hãy làm nó thành **app thứ hai** trong cùng workspace. Hai app nói chuyện với nhau qua **MQTT**.

## Ví dụ: cảnh báo quá tốc độ qua hai app
- **App A, "producer":**
  - **When Speed changes** ⇒ **If** `<speed.value> > 120`;
  - nhánh *then*: **Publish MQTT** topic `fleet/overspeed`, payload `on`;
  - nhánh *else*: cùng topic, payload `off`.
- **App B, "consumer":**
  - **When MQTT message** topic `fleet/overspeed` ⇒ **If** `<alert.payload> == "on"`;
  - *then*: **Set** `Vehicle.Body.Lights.Hazard.IsSignaling = true`;
  - *else*: đặt `false`.

Topic viết sao thì dùng đúng như vậy. Hai app chỉ cần dùng **cùng một chuỗi topic**. Tiền tố topic của app (`mqttTopicPrefix`) chỉ dùng để lọc tab **Messages**, không gắn thêm vào topic.

## Chạy hai app cùng lúc
- Mặc định (`SV_RUN_SANDBOX=0`), cả máy chỉ chạy **một** app một lúc, trên databroker dùng chung. Như vậy bạn không chạy được producer và consumer cùng lúc.
- Đặt `SV_RUN_SANDBOX=1` trong `.env` rồi `scripts/sv up`. Mỗi run có databroker riêng, mỗi người tối đa `SV_MAX_RUNS_PER_USER` (mặc định 2) app cùng lúc ([DEPLOY](../DEPLOY.md)). Bấm **Run** ở app thứ hai, chọn **Run both**.
- Trong tab Live của **producer**, inject `Vehicle.Speed = 130`. Trong tab Live của **consumer**, hazard đổi thành `true`.
- Mỗi app có databroker riêng, nên chỉ thông điệp MQTT nối hai app với nhau. Tab **Messages** của consumer cho thấy message nhận được.

Kiểm tự động trên stack: `modules/simvehicleapp-orchestrator/gate/two-apps-mqtt.sh [cpp|python|rust]`. Gate tự bật sandbox cho orchestrator trong lúc chạy, rồi trả lại như cũ.

## Giới hạn
- **Chưa có "nhóm app":** chưa có thao tác SynCode, Run hay Export cả nhóm. Mỗi app làm riêng.
- **Chưa có gRPC giữa các app:** xem [ADR-0043](../../analysis/adr/ADR-0043-grpc-service-interface.md).
