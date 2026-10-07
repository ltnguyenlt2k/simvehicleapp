# 11b — Kiểm kê block Sim (giữ/xoá) & bảng tạo block mới ↔ VSS

> Bổ sung cho [11-sim-refactor-plan.md](11-sim-refactor-plan.md) (vốn chỉ nói ở **cấp thư mục**: "xoá `tools/`, `triggers/`…") và [05-blocks-and-execution-model.md](05-blocks-and-execution-model.md) (catalog block **mới**, chưa đối chiếu ngược với block cũ). Tài liệu này trả lời trực tiếp: *"trong 268 block thật của Sim, cái nào xoá, cái nào có thể tham khảo cơ chế, và 41 block mới cần tạo map với VSS nào"*.
> Dữ liệu lấy bằng cách đọc trực tiếp 268 file trong `modules/simvehicleapp-studio/apps/sim/blocks/blocks/*.ts` (snapshot Sim v0.7.13 đã có sẵn trong repo) ngày 2026-10-01 — không suy đoán tên block.
> Liên quan: [ADR-0008](adr/ADR-0008-sim-refactor-strategy.md), [ADR-0011](adr/ADR-0011-block-model-on-canvas.md), [ADR-0013](adr/ADR-0013-dataflow-and-expression-language.md).

---

## 1. Số liệu kiểm kê thật

`apps/sim/blocks/blocks/` có **268 file block thật** (273 file `.ts` trừ 5 file `.test.ts`), chia theo field `category` khai báo trong chính từng `BlockConfig`:

| category | Số lượng | Bản chất |
|---|---|---|
| `tools` | **221** | Tích hợp SaaS/API bên thứ ba (Slack, Gmail, Pinecone, Salesforce, AWS…) |
| `blocks` | **36** | Cơ chế workflow lõi (Agent, Condition, Function, Variables, Wait…) |
| `triggers` | **11** | Điểm bắt đầu workflow (Schedule, Webhook, Manual, Chat…) |

**Kết luận chung:** `tools` (221, 82%) **xoá toàn bộ không cần xét từng cái** — 100% là tích hợp SaaS/AI không có khái niệm tương đương trong ô tô. `blocks` và `triggers` (47, 18%) là cơ chế workflow lõi của chính Sim → **phải xét từng file** vì một số là cơ chế nền tảng (giữ), một số là tính năng AI/SaaS núp dưới category khác (xoá), một số là **mẫu tham khảo cấu trúc tốt** cho block mới (tham khảo rồi viết lại, không sửa file cũ — đúng nguyên tắc clean-room/không copy logic AI).

---

## 2. Quy ước quyết định (4 nhãn)

| Nhãn | Nghĩa | Hành động |
|---|---|---|
| **XOÁ** | Không có công dụng cho vehicle no-code (SaaS/AI-agent-specific) | Ẩn khỏi toolbar ngay ở M1 (allowlist), xoá file thật ở M11 (đợt 3, theo ADR-0008) |
| **GIỮ NGUYÊN** | Thuần UI/canvas, không chứa logic AI/SaaS, dùng được ngay không cần sửa | Giữ trong allowlist, không đổi code |
| **THAM KHẢO** | Đúng khái niệm cần nhưng cơ chế implementation (JS eval, OAuth, cloud deploy…) không dùng được | **Không sửa/import file cũ** — đọc hiểu UI/UX pattern rồi viết `BlockSpec` + `BlockConfig` hoàn toàn mới trong `blocks/vehicle/` (đúng tinh thần clean-room của ADR-0004 áp dụng rộng ra, dù bản thân code Sim ở đây là Apache-2.0 nên **được phép** đọc/copy một phần UI component nếu muốn — khác với Scratch) |
| **HOÃN** | Có thể cần ở P2/M14 nhưng không phải MVP | Xoá khỏi toolbar M1, giữ lại trong danh sách theo dõi, không xoá file cho tới khi chắc chắn không cần |

---

## 3. `category: tools` (221) — XOÁ toàn bộ

Không có ngoại lệ. Danh sách đầy đủ 221 tên (đã trích xuất thật từ field `name` của từng `BlockConfig`, sắp theo alphabet) — để đối chiếu khi viết allowlist/CI guard, **không phải để đọc từng cái**:

<details><summary>Toàn bộ 221 tên block `tools` (bấm để xem)</summary>

1Password, AWS AppConfig, AWS IAM, AWS Identity Center, AWS SES, AWS STS, AWS Secrets Manager, AWS Textract, AgentMail, AgentPhone, Agiloft, Ahrefs, Airtable, Airweave, Algolia, Amazon DynamoDB, Amazon RDS, Amazon SQS, Amplitude, Apify, Apollo, ArXiv, Asana, Ashby, Athena, Attio, Azure AD, Azure DevOps, Box, Brandfetch, Brex, Bright Data, Browser Use, Cal.com, Calendly, Clay, Clerk, ClickHouse, CloudFormation, CloudWatch, Cloudflare, CodePipeline, Confluence (Legacy), Context.dev, Convex, CrowdStrike, Cursor (Legacy), DSPy, Dagster, Databricks, Datadog, Datagma, Daytona, Devin, Discord, DocuSign, Dropbox, Dropcontact, Dub, DuckDuckGo, Elasticsearch, ElevenLabs, Email Bison, Embeddings, Enrich, Enrow, Evernote, Exa, Extend, Fathom, Findymail, Firecrawl, Fireflies (Legacy), Gamma, GitHub (Legacy), GitLab, Gmail (Legacy), Gong, Google Ads, Google BigQuery, Google Books, Google Calendar (Legacy), Google Contacts, Google Docs, Google Drive, Google Forms, Google Groups, Google Maps, Google Meet, Google PageSpeed, Google Search, Google Sheets (Legacy), Google Slides (Legacy), Google Tasks, Google Translate, Google Vault, Grafana, Grain, Granola, Greenhouse, Greptile, Hex, HubSpot, Hugging Face, Hunter.io, Icypeas, Infisical, Instantly, Intercom (Legacy), Jina, Jira, Jira Service Management, Kalshi (Legacy), Ketch, LaTeX, LangSmith, LaunchDarkly, LeadMagic, Lemlist, Linear (Legacy), LinkedIn, Linkup, Linq, Loops, Luma, Mailchimp, Mailgun, Mem0, Microsoft Dataverse, Microsoft Excel (Legacy), Microsoft Planner, Microsoft Teams, MillionVerifier, Mistral Parser (Legacy), Monday, MongoDB, MySQL, Neo4j, NeverBounce, New Relic, Notion (Legacy), Obsidian, Okta, OneDrive, Outlook, PagerDuty, Parallel AI, People Data Labs, Perplexity, Persona, Pinecone, Pipedrive, Polymarket, PostHog, PostgreSQL, Profound, Prospeo, Pulse, Qdrant, Quartr, Quiver, RB2B, Railway, Reddit, Redis, Reducto, Resend, RevenueCat, Rippling, Rootly, S3, SAP Concur, SAP S4HANA, SFTP, SMTP, SSH, Salesforce, SendGrid, Sendblue, Sentry, Serper, ServiceNow, Sharepoint, Shopify, Similarweb, Sixtyfour AI, Slack, Sportmonks, Spotify, Square, Stagehand, Stripe, Supabase, Tailscale, Tavily, Telegram, Temporal, Tinybird, Trello, Trigger.dev, Twilio SMS, Twilio Voice, Typeform, Upstash, Vanta, Vercel, Wealthbox, Webflow, WhatsApp, Wikipedia, Wiza, WordPress, Workday, X, YouTube, Zendesk, Zep, ZeroBounce, Zoom, ZoomInfo, incident.io

</details>

**Lý do xoá đồng loạt:** tất cả 221 đều thuộc `IntegrationType` = Sales/AI/DevOps/Search/Documents/Databases/Communication/Productivity/Analytics/Security/Email/Observability/HR/Commerce/Support/Marketing (đếm thật: AI 25, Sales 28, DevOps 22, Search 20, Documents 20, Databases 18, Communication 17, Productivity 17, Analytics 15, Security 15, Email 14, Observability 10, HR 5, Commerce 5, Support 4, Marketing 3) — **không có nhóm "Automotive/Vehicle"**, và theo nguyên tắc cốt lõi của SimVehicleApp (Master Plan 3.1–3.2), workflow không được gọi dịch vụ SaaS bên ngoài tuỳ ý; mọi giao tiếp ra ngoài chỉ qua `comm.mqtt_publish`/`service.grpc_call` đã định nghĩa trong AppManifest.

**Hành động cụ thể (M1):** env `SV_TOOLBAR_ALLOWLIST` (đã có trong [phases/M01-studio-shell.md M01-T05](phases/M01-studio-shell.md)) chỉ liệt kê type bắt đầu bằng `sv_`; không cần sửa từng file. **Hành động M11 (đợt 3, ADR-0008):** xoá hẳn `apps/sim/blocks/blocks/<221 file này>.ts`, xoá thư mục `apps/sim/tools/<provider>/` tương ứng (4091 file theo kiểm kê ở [11 §1](11-sim-refactor-plan.md)), xoá `IntegrationType` values không còn dùng trong `blocks/types.ts`.

---

## 4. `category: blocks` (36) — xét từng file

| File | Tên / mô tả thật | Quyết định | Lý do / block mới nào tham khảo |
|---|---|---|---|
| `agent.ts` | Agent — "Build an agent" (gọi LLM, tool-calling) | **XOÁ** khỏi canvas | Đây chính là block AI Master Plan 3.3 cấm dùng trong pipeline sinh code. **Lưu ý khác biệt quan trọng:** bản thân `apps/sim/providers/*` (adapter gọi Anthropic/OpenAI/Gemini…) mà `agent.ts` phụ thuộc **không bị xoá** — được tách riêng để tái dùng trong `simvehicleapp-ai` theo [ADR-0030](adr/ADR-0030-ai-assistant-mcp.md). Chỉ xoá *block trên canvas*, giữ *thư viện provider* |
| `condition.ts` | Condition — "Add a condition" (biểu thức JS qua `isolated-vm`) | **THAM KHẢO** | Mẫu UI branch "then/else" cho `sv_if`/`sv_switch`. Không dùng engine JS eval (lý do chính của [ADR-0013](adr/ADR-0013-dataflow-and-expression-language.md)) |
| `api.ts` | API — "Use any API" (gọi HTTP tuỳ ý) | **XOÁ** (v1) / **HOÃN** ý tưởng | Vehicle app không gọi HTTP tuỳ ý (chỉ `service.grpc_call` đã khai báo trước trong AppManifest). UI cấu hình method/headers có thể liếc qua khi làm `sv_grpc_call` ở M14 |
| `function.ts` | Function — "Run custom logic" (chạy JS/Python tuỳ ý) | **XOÁ** | Đối lập trực tiếp với nguyên tắc tất định (Master Plan 3.3); chính là lý do SVX expression language tồn tại thay vì cho phép code tuỳ ý |
| `variables.ts` | Variables — "Set workflow-scoped variables" | **THAM KHẢO mạnh** | Cơ chế gần như 1:1 với "Panel Variables" cần cho `sv_var_get`/`sv_var_set` ([ADR-0011](adr/ADR-0011-block-model-on-canvas.md)) — tham khảo UI khai báo tên/kiểu/giá trị đầu |
| `wait.ts` | Wait — "Pause workflow execution for a time interval" | **THAM KHẢO mạnh** | Khớp gần 1:1 `sv_wait`; tham khảo subblock nhập thời lượng (số + đơn vị) cho `sv-duration` |
| `webhook_request.ts` | Outgoing Webhook — "Send a webhook request" | **THAM KHẢO yếu** | Ý tưởng "gửi thông báo ra ngoài, có payload template" gần với `sv_mqtt_publish`/`sv_hmi_notify`, nhưng transport khác hẳn (HTTP POST vs MQTT) — chỉ tham khảo UI editor payload, viết lại hoàn toàn |
| `response.ts` | Response — "Send structured API response" | **XOÁ** | Gắn với tính năng "deploy workflow thành HTTP endpoint" của Sim — vehicle app không có bề mặt HTTP response |
| `workflow.ts`, `workflow_input.ts` | Gọi workflow con, map biến vào Start trigger | **HOÃN** | Đúng khái niệm `sv_call_workflow` (M14, xem [05 §2.8](05-blocks-and-execution-model.md#28-composite)) nhưng chưa cần ở MVP |
| `starter.ts`, `start_trigger.ts` | Starter/Start — điểm bắt đầu DAG (nút Run) | **THAM KHẢO** | Gần nhất với `sv_on_app_start`; cả hai đều "không cấu hình, chỉ là entrypoint" |
| `credential.ts` | Credential — "Select or list OAuth credentials" | **XOÁ** (v1) / **HOÃN** ý tưởng | Gắn với hệ OAuth cho 221 tool đã xoá. Ý tưởng "chọn credential đã lưu" có thể cần lại ở M14 cho auth gRPC — viết block mới riêng, không hồi sinh file này |
| `deployments.ts` | Deployments — "Manage workflow deployments" | **XOÁ** | Thay thế hoàn toàn bằng orchestrator/SynCode UI (Part 4) |
| `enrichment.ts` | Data Enrichment (People Data Labs…) | **XOÁ** | SaaS enrichment, không liên quan |
| `evaluator.ts` | Evaluator — chấm điểm output LLM theo tiêu chí | **XOÁ** | AI-specific |
| `guardrails.ts` | Guardrails — validate nội dung LLM | **XOÁ** | AI-specific |
| `human_in_the_loop.ts` | Pause workflow, chờ người duyệt qua UI web | **XOÁ** | Mô hình "dừng DAG chờ người bấm duyệt trên web" không khớp runtime embedded liên tục của vehicle app. Khái niệm "cần xác nhận" trong SimVehicleApp nằm ở tầng AI-assistant (WorkflowPatch) chứ không phải block trên canvas chạy trên xe |
| `knowledge.ts` | Knowledge — vector search / RAG | **XOÁ** | AI-specific; "kiến thức có cấu trúc" của SimVehicleApp chính là VSS Catalog |
| `memory.ts` | Memory — bộ nhớ hội thoại agent | **XOÁ** | AI-specific |
| `mcp.ts` | MCP Tool — gọi tool từ MCP server khác **trong DAG** | **XOÁ** khỏi canvas | Không nhầm với MCP của `simvehicleapp-ai` ([ADR-0030](adr/ADR-0030-ai-assistant-mcp.md)) — đó là MCP cho **chat assistant**, không phải block chạy trong code C++ sinh ra. Compile-first cấm gọi dịch vụ ngoài tuỳ ý từ code sinh ra |
| `search.ts` | Search — web search trả phí | **XOÁ** | SaaS |
| `table.ts` | Table — bảng dữ liệu người dùng định nghĩa | **XOÁ** (v1) | Không cần cho MVP; UI bảng có thể tham khảo rất loosely cho editor `sv_lookup.table[]` sau này |
| `note.ts` | Note — "Add contextual annotations directly onto the workflow canvas" | **GIỮ NGUYÊN** | 100% thuần canvas annotation, không chứa logic AI/SaaS nào — **dùng được ngay không cần sửa 1 dòng**, hữu ích để chú thích workflow ô tô |
| `a2a.ts` | A2A — giao tiếp agent-to-agent | **XOÁ** | AI-specific |
| `mothership.ts` | "Talk to Sim" | **XOÁ** | Chính là copilot backend độc quyền `copilot.sim.ai` mà [ADR-0008](adr/ADR-0008-sim-refactor-strategy.md)/[ADR-0030](adr/ADR-0030-ai-assistant-mcp.md) yêu cầu gỡ |
| `pi.ts` | Pi Coding Agent — chạy coding agent trên repo | **XOÁ** | Tính năng SaaS riêng của Sim |
| `thinking.ts` | Ép model xuất chain-of-thought | **XOÁ** | AI-specific |
| `translate.ts` | Translate (Google Translate AI) | **XOÁ** | SaaS/AI |
| `tts.ts`, `stt.ts` | Text-to-Speech / Speech-to-Text | **XOÁ** | AI-specific (dù về sau xe có thể cần TTS cho HMI, đó sẽ là tích hợp phần cứng xe thật, không phải gọi API cloud) |
| `image_generator.ts`, `video_generator.ts`, `vision.ts` | Sinh/phân tích ảnh-video bằng AI | **XOÁ** | AI-specific, đã `hidden=True` (Legacy) sẵn trong Sim |
| `file.ts` | File (Legacy) — thao tác file đính kèm | **XOÁ** | Gắn với hệ upload file của Sim (S3/Azure Blob), không liên quan |
| `logs.ts` | Logs — đọc log thực thi workflow Sim | **XOÁ** (v1) | Thay bằng Run console/Signals panel của chính SimVehicleApp ([08](08-run-debug-observe.md)) |
| `router.ts` | Router (Legacy) — định tuyến rẽ nhánh kiểu cũ | **XOÁ** | Đã `hidden=True`, bị thay bởi `condition.ts` trong chính Sim — không cần tham khảo thêm ngoài những gì `condition.ts` đã cho |

---

## 5. `category: triggers` (11) — xét từng file

| File | Tên / mô tả thật | Quyết định | Lý do / block mới nào tham khảo |
|---|---|---|---|
| `schedule.ts` | Schedule — trigger theo cron/interval | **THAM KHẢO mạnh** | Tổ tiên trực tiếp của `sv_on_timer`; tham khảo UI chọn interval (vehicle app dùng ms đơn giản, không cần cú pháp cron đầy đủ vì không có cron daemon trong embedded runtime) |
| `generic_webhook.ts` | Webhook — nhận HTTP POST từ ngoài, khởi chạy workflow | **THAM KHẢO yếu** | Cùng *khái niệm* "sự kiện ngoài khởi chạy workflow" như `sv_on_mqtt`, khác hẳn transport (HTTP vs MQTT) — chỉ tham khảo bố cục UI, viết lại toàn bộ |
| `manual_trigger.ts` | Manual (Legacy) — nút "Run" thủ công | **THAM KHẢO** | Gần nhất với `sv_on_app_start` (không cấu hình, chỉ là entrypoint); đã `hidden=True` trong chính Sim |
| `chat_trigger.ts` | Chat — khởi chạy workflow từ tin nhắn chat | **XOÁ** | Gắn với tính năng "Sim as a chatbot", đã `hidden=True` |
| `api_trigger.ts` | API (Legacy) — khởi chạy qua gọi API | **XOÁ** | Thay thế hoàn toàn bởi orchestrator API, đã `hidden=True` |
| `input_trigger.ts` | Input Form (Legacy) — form nhập liệu khởi chạy | **XOÁ** | Không có khái niệm "form web" trong vehicle app embedded, đã `hidden=True` |
| `circleback.ts` | Circleback — trigger khi có ghi chú cuộc họp mới | **XOÁ** | SaaS (meeting notes), hoàn toàn không liên quan |
| `imap.ts` | IMAP Email — trigger khi có email mới | **XOÁ** | SaaS |
| `rss.ts` | RSS Feed — trigger khi feed RSS có bài mới | **XOÁ** | SaaS |
| `sim_workspace_event.ts` | Sim Workspace Events — trigger theo sự kiện nội bộ Sim (vd workflow khác chạy xong) | **XOÁ** | Gắn chặt với mô hình multi-workflow SaaS của Sim, không có tương đương trong 1 vehicle app |

---

## 6. Cơ chế đặc biệt: subflow `loop`/`parallel`

**Không phải** block định nghĩa qua file `BlockConfig` thông thường trong `blocks/blocks/*.ts` — xác nhận qua grep `app/workspace/[workspaceId]/w/[workflowId]/components/action-bar/action-bar.tsx:116`: `blockType === 'loop' || blockType === 'parallel'` được special-case cứng trong code canvas, cấu hình qua `components/panel/components/editor/components/subflow-editor/`, dữ liệu theo `SUBFLOW_TYPES` trong `packages/workflow-types/src/workflow.ts` (đã nêu ở [00 §2.3](00-research-findings.md#23-mô-hình-dữ-liệu-workflow-quan-trọng-cho-compiler)).

**Quyết định:** `sv_repeat` và `sv_parallel` (M3) **tái dùng đúng cơ chế container này** (không phải block thường). Đã verify trực tiếp `packages/workflow-types/src/workflow.ts`: `LoopConfig.loopType: 'for' | 'forEach' | 'while' | 'doWhile'` (có `whileCondition`/`doWhileCondition: string`) — **Sim đã hỗ trợ while/doWhile ở tầng config/editor**. `sv_while` vì vậy **không cần viết container canvas mới** — dùng thẳng `loop` subflow có sẵn với `loopType: 'while'`, chỉ thay `whileCondition` (vốn là JS string) bằng SVX expression. Việc này đơn giản hoá M3 so với mô tả trước đây.
**Lưu ý nhỏ (không ảnh hưởng quyết định trên):** cùng file còn có interface `LoopBlock` (dùng cho trạng thái thực thi/kích thước hiển thị khi **chạy bằng executor của Sim**) chỉ khai `loopType: 'for' | 'forEach'` — tức executor JS gốc của Sim có thể chưa hỗ trợ chạy while/doWhile ở runtime. Không quan trọng với SimVehicleApp vì theo [ADR-0006](adr/ADR-0006-compile-first-execution-model.md), ta **không bao giờ dùng executor của Sim** để chạy vehicle workflow — chỉ tái dùng `LoopConfig` ở tầng lưu trữ/canvas, còn thực thi `while` do Simulator/Runtime của chính SimVehicleApp tự làm.

---

## 7. Bảng tổng 41 block mới ↔ cơ chế Sim tham khảo ↔ VSS minh hoạ đã verify thật

Danh sách gốc: [05-blocks-and-execution-model.md §2](05-blocks-and-execution-model.md#2-catalog-block-chi-tiết-v1).

Cột "VSS ví dụ" lấy từ `vss_rel_4.0.json` thật (đã verify tồn tại — xem [skill vss-signals](../.claude/skills/vss-signals/SKILL.md)), không bịa path.

| Block mới | Nhóm | Cơ chế Sim tham khảo | VSS ví dụ (đã verify) |
|---|---|---|---|
| `sv_on_app_start` | Trigger | `starter.ts`/`manual_trigger.ts` (entrypoint không cấu hình) | — |
| `sv_on_signal_changed` | Trigger | *(mới hoàn toàn — không có tương đương Sim; gần nhất về ý tưởng là `generic_webhook.ts` "sự kiện ngoài → chạy")* | `Vehicle.Speed` |
| `sv_on_timer` | Trigger | `schedule.ts` (UI chọn interval) | — |
| `sv_on_condition` | Trigger | `condition.ts` (editor biểu thức) + ý tưởng edge-trigger mới | `Vehicle.Body.Raindetection.Intensity`, `Vehicle.Speed` |
| `sv_on_mqtt` | Trigger | `generic_webhook.ts` (bố cục "nhận sự kiện ngoài") | topic `simvehicleapp/<app>/cmd` |
| `sv_read_signal` | Sensor | *(mới — VSS-driven, xem ADR-0011)* | `Vehicle.Speed` |
| `sv_read_attribute` | Sensor | *(mới)* | `Vehicle.VersionVSS.Major` |
| `sv_set_actuator` | Actuator | *(mới)* | `Vehicle.Body.Lights.Hazard.IsSignaling` |
| `sv_set_many` | Actuator | *(mới)* | `Vehicle.Cabin.Door.Row1.{DriverSide,PassengerSide}.IsLocked` |
| `sv_toggle` | Actuator | *(mới, desugar ở compiler)* | `Vehicle.Body.Lights.Beam.Low.IsOn` |
| `sv_compare`, `sv_bool`, `sv_math`, `sv_constant` | Logic | `condition.ts` (hình dạng operator picker) | — |
| `sv_expression` | Logic | `condition.ts` (bộ editor ô nhập của Sim — xem [ADR-0013 Notes](adr/ADR-0013-dataflow-and-expression-language.md)) | — |
| `sv_scale`, `sv_clamp`, `sv_in_range`, `sv_lookup`, `sv_convert` | Logic | *(mới)* | `Vehicle.Powertrain.TractionBattery.StateOfCharge.Current` (percent, 0–100) |
| `sv_if`, `sv_switch` | Flow | `condition.ts` (branch UI) | — |
| `sv_wait` | Flow | `wait.ts` (gần 1:1) | — |
| `sv_wait_until`, `sv_stable_for` | Flow | `wait.ts` (UI thời lượng) + điều kiện của `condition.ts` | — |
| `sv_repeat` | Flow | **container `loop`** có sẵn (`loopType: 'for'`) | — |
| `sv_while` | Flow | **container `loop`** có sẵn (`loopType: 'while'` — xem §6, **không cần viết mới**) | — |
| `sv_parallel` | Flow | **container `parallel`** có sẵn | — |
| `sv_stop` | Flow | *(mới)* | — |
| `sv_throttle` | Flow | *(mới)* | — |
| `sv_var_get`, `sv_var_set` | State | `variables.ts` (gần 1:1) | — |
| `sv_counter`, `sv_filter`, `sv_rate`, `sv_state_machine` | State | `variables.ts` (lưu trạng thái) + *(logic mới)* | — |
| `sv_log` | Comm | *(mới, đơn giản)* | — |
| `sv_mqtt_publish` | Comm | `webhook_request.ts` (payload template editor) | topic `simvehicleapp/<app>/telemetry` |
| `sv_hmi_notify` | Comm | `webhook_request.ts` (desugar → mqtt_publish) | — |
| `sv_grpc_call` | Comm | `api.ts` (UI chọn method/tham số, M14) | — |
| `sv_call_workflow` | Composite | `workflow.ts`/`workflow_input.ts` (M14) | — |
| `sv_battery_status`, `sv_door_status`, `sv_climate_status` | Composite | *(curated thủ công, M14, [ADR-0045](adr/ADR-0045-curated-multi-vss-blocks.md))* | vd. "Battery status" gộp `TractionBattery.StateOfCharge.Current`, `CurrentVoltage`, `CurrentCurrent`, `Charging.IsCharging` |

---

## 8. Việc cần làm (cập nhật vào phase file khi thực thi)

1. **M1 ([M01-studio-shell.md](phases/M01-studio-shell.md)):** `SV_TOOLBAR_ALLOWLIST` ẩn 268−1 block (giữ `note.ts`) + tất cả `tools/`; không sửa file cũ.
2. **M2–M3 ([M02](phases/M02-vss-catalog-and-vehicle-blocks.md), [M03](phases/M03-logic-flow-blocks.md)):** khi viết từng `BlockSpec` mới, mở file Sim tương ứng ở cột "Cơ chế tham khảo" (bảng §4/§5) để lấy **UX/layout**, không import/gọi code cũ — viết `BlockConfig` hoàn toàn mới trong `apps/sim/blocks/vehicle/`.
3. **M3:** cập nhật lại ước lượng — `sv_while` dùng thẳng container `loop` có sẵn (`loopType: 'while'`), giảm việc so với mô tả cũ.
4. **M11 (đợt 3, [ADR-0008](adr/ADR-0008-sim-refactor-strategy.md)):** xoá thật 221 file `tools` + toàn bộ `apps/sim/tools/<provider>/` + các file **XOÁ** ở bảng §4/§5 (giữ lại `note.ts` và mọi thứ ở nhóm **HOÃN** cho tới khi M14 xác nhận không cần).
5. **CI guard mới (gợi ý, chưa có trong doc nào khác):** sau M1, `apps/sim/blocks/vehicle/**` không được `import` bất cứ gì từ `apps/sim/tools/**` hay `apps/sim/blocks/blocks/{agent,function,mcp,knowledge,memory}.ts` — chặn rò rỉ phụ thuộc AI vào block vehicle.
