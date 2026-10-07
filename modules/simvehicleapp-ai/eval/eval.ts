/**
 * Eval set (M10-T09): 20 prompts (VI/EN) on an empty workflow; a prompt passes when the assistant ends the
 * turn with a valid WorkflowPatch (no compiler error, every added block reachable, only real props).
 * Target ≥ 80 %. Prints one line per prompt and the rate; `--json` writes the details.
 */
import { writeFileSync } from "node:fs";
import { chat } from "./chat.ts";

export const PROMPTS = [
  "Turn on the hazard lights when the speed stays above 120 km/h for 2 seconds.",
  "When the vehicle starts moving, lock the driver door.",
  "Every 5 seconds publish the vehicle speed on the MQTT topic telemetry/speed.",
  "Show an HMI warning when the battery state of charge is below 15%.",
  "When the driver door opens while the vehicle is moving, show a critical HMI alert.",
  "Log a message when the app starts.",
  "When the speed changes, log \"fast\" if it is above 100 km/h, otherwise log \"slow\".",
  "When the battery drops below 10%, set the interactive light bar color to RED.",
  "Turn off the hazard lights when the speed falls below 100 km/h.",
  "When the outside air temperature is below 5 °C, turn on the rear windshield heating.",
  "Bật đèn cảnh báo nguy hiểm khi tốc độ trên 130 km/h.",
  "Khi xe dừng lại thì mở khoá cửa tài xế.",
  "Mỗi giây gửi mức pin lên MQTT topic xe/pin.",
  "Hiện thông báo HMI chào mừng khi ứng dụng khởi động.",
  "Khi cửa sau bên trái mở lúc xe đang chạy thì cảnh báo nghiêm trọng trên HMI.",
  "Khi tốc độ vượt 80 km/h liên tục 5 giây thì ghi log \"quá tốc độ\".",
  "Khi pin dưới 20% và xe đang chạy thì đổi thanh đèn sang màu đỏ.",
  "Khi nhận MQTT topic xe/lenh với nội dung \"khoa\" thì khoá cửa tài xế.",
  "Tắt đèn cảnh báo nguy hiểm khi xe dừng hẳn.",
  "Cảnh báo HMI khi pin dưới 20% lúc xe đang chạy",
];

const results: { prompt: string; valid: boolean; seconds: number; blocks: string[]; errors: string[]; note?: string }[] = [];
for (const [i, prompt] of PROMPTS.entries()) {
  const r = await chat(prompt, { user: `eval-${i}` });
  const p = r.proposal;
  const errors = (p?.diagnostics ?? []).filter((d) => d.severity === "error").map((d) => `${d.code}: ${d.message}`);
  results.push({ prompt, valid: Boolean(p?.valid), seconds: Math.round(r.ms / 1000), blocks: p?.graph.blocks.map((b) => b.type) ?? [], errors, ...(p ? {} : { note: r.error ?? r.text.slice(0, 160) }) });
  const x = results.at(-1)!;
  console.log(`${String(i + 1).padStart(2)} ${x.valid ? "PASS" : "FAIL"} ${String(x.seconds).padStart(3)} s  ${prompt}${x.valid ? `  [${x.blocks.join(" → ")}]` : `  — ${errors[0] ?? x.note ?? "no proposal"}`}`);
}
const valid = results.filter((r) => r.valid).length;
console.log(`\nvalid patches: ${valid}/${results.length} = ${Math.round((100 * valid) / results.length)} %`);
if (process.argv.includes("--json")) writeFileSync("/out/m10-eval.json", JSON.stringify({ results, valid, total: results.length }, null, 2));
process.exit(valid / results.length >= 0.8 ? 0 : 1);
