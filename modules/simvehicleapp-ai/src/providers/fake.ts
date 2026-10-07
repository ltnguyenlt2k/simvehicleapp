import type { ContentBlock, LlmProvider, Message, TextBlock, ToolUseBlock, TurnRequest, TurnResult } from "./types.ts";

/**
 * Simulated LLM (`SV_AI_PROVIDER=fake`): deterministic, no model and no network — for machines that
 * cannot host a model and for demos/E2E. It understands a few request shapes (VI/EN) and drives the
 * real tool loop exactly like a model would: it proposes WorkflowPatch ops (validated by the compiler,
 * shown as a diff), asks to run through the confirmation gate, and answers from the tool results.
 * Anything else gets a short help text. It reads the open workflow and the project from the system
 * prompt, as a model does.
 */

const SPEED = "Vehicle.Speed";
const HAZARD = "Vehicle.Body.Lights.Hazard.IsSignaling";
const SOC = "Vehicle.Powertrain.TractionBattery.StateOfCharge.Current";

type Op = Record<string, unknown>;

/** Lowercase without Vietnamese diacritics (đ ⇒ d), for matching. */
export function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

const vietnamese = (text: string) => /[ăâđêôơưàáạảãèéẹẻẽìíịỉĩòóọỏõùúụủũỳýỵỷỹ]/i.test(text);
const normalizeName = (name: string) => name.toLowerCase().replace(/[\s.]+/g, "");

/** Block names already in the open workflow (from the system prompt), so new names stay unique. */
function takenNames(system: string): Set<string> {
  const blocks = /Blocks: (.*?)\. Edges:/s.exec(system)?.[1] ?? "";
  return new Set([...blocks.matchAll(/"([^"]+)"/g)].map((m) => normalizeName(m[1]!)));
}

function unique(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(normalizeName(candidate)); n++) candidate = `${name} ${n}`;
  taken.add(normalizeName(candidate));
  return candidate;
}

const numbers = (text: string) => [...text.matchAll(/(\d+(?:[.,]\d+)?)/g)].map((m) => Number(m[1]!.replace(",", ".")));

/** The patch for a request, or null when the request is not one the simulation understands. */
export function plan(message: string, system: string): { ops: Op[]; summary: string } | null {
  const p = draftPlan(message, system);
  // Blocks first, then their connections (the order a careful model writes).
  return p && { ...p, ops: [...p.ops.filter((o) => o.op === "add_block"), ...p.ops.filter((o) => o.op !== "add_block")] };
}

function draftPlan(message: string, system: string): { ops: Op[]; summary: string } | null {
  const t = fold(message);
  const taken = takenNames(system);
  const below = /\b(below|under|less|drops?|falls?|duoi|thap hon|giam)\b|</.test(t);
  const op = below ? "<" : ">";
  const [n1, n2] = numbers(t);
  const seconds = /(\d+)\s*(s|sec|seconds|giay)\b/.exec(t);
  const holdMs = seconds ? Number(seconds[1]) * 1000 : undefined;
  const hmi = /\b(hmi|alert|warn|warning|notify|notification|canh bao|thong bao)\b/.test(t) && !/hazard|nguy hiem/.test(t);

  if (/\b(speed|toc do)\b/.test(t) && n1 !== undefined && /hazard|nguy hiem|den/.test(t)) {
    const limit = n1;
    const off = /\b(off|tat)\b/.test(t);
    const trigger = unique("Speed changed", taken);
    const ref = `<${normalizeName(trigger)}.value> ${op} ${limit}`;
    const set = unique(off ? "Hazard off" : "Hazard on", taken);
    const ops: Op[] = [{ op: "add_block", ref: "t1", type: "sv_on_signal_changed", name: trigger, props: { path: SPEED, mode: "any" } }];
    if (holdMs) {
      ops.push({ op: "add_block", ref: "c1", type: "sv_stable_for", name: unique(`${op === ">" ? "Over" : "Under"} ${limit} for ${holdMs / 1000} s`, taken), props: { condition: ref, durationMs: holdMs } });
      ops.push({ op: "connect", from: "t1", fromHandle: "source", to: "c1" });
      ops.push({ op: "add_block", ref: "a1", type: "sv_set_actuator", name: set, props: { path: HAZARD, value: off ? "false" : "true" } });
      ops.push({ op: "connect", from: "c1", fromHandle: "stable", to: "a1" });
    } else {
      ops.push({ op: "add_block", ref: "c1", type: "sv_if", name: unique(`Speed ${op} ${limit}`, taken), props: { condition: ref } });
      ops.push({ op: "connect", from: "t1", fromHandle: "source", to: "c1" });
      ops.push({ op: "add_block", ref: "a1", type: "sv_set_actuator", name: set, props: { path: HAZARD, value: off ? "false" : "true" } });
      ops.push({ op: "connect", from: "c1", fromHandle: "then", to: "a1" });
    }
    return { ops, summary: `Speed ${op} ${limit} km/h${holdMs ? ` for ${holdMs / 1000} s` : ""} ⇒ hazard lights ${off ? "off" : "on"}` };
  }

  if (/\b(battery|pin|soc|charge)\b/.test(t) && n1 !== undefined) {
    const limit = n1;
    const trigger = unique("Battery changed", taken);
    const moving = /\b(moving|driving|dang chay|chay)\b/.test(t);
    const ref = `<${normalizeName(trigger)}.value> ${op} ${limit}${moving ? " && <Vehicle.IsMoving>" : ""}`;
    const action: Op = hmi || !/\blog\b/.test(t)
      ? { op: "add_block", ref: "a1", type: "sv_hmi_notify", name: unique("Low battery warning", taken), props: { severity: "warning", title: "Battery low", message: `Battery below ${limit} %` } }
      : { op: "add_block", ref: "a1", type: "sv_log", name: unique("Log battery", taken), props: { level: "warn", message: `Battery ${op} ${limit} %` } };
    return {
      ops: [
        { op: "add_block", ref: "t1", type: "sv_on_signal_changed", name: trigger, props: { path: SOC, mode: "any" } },
        { op: "add_block", ref: "c1", type: "sv_if", name: unique(`Battery ${op} ${limit}`, taken), props: { condition: ref } },
        { op: "connect", from: "t1", fromHandle: "source", to: "c1" },
        action,
        { op: "connect", from: "c1", fromHandle: "then", to: "a1" },
      ],
      summary: `battery ${op} ${limit} %${moving ? " while moving" : ""} ⇒ ${action.type === "sv_hmi_notify" ? "HMI warning" : "log"}`,
    };
  }

  if (/\b(app starts?|start(s|ed)?|startup|khoi dong)\b/.test(t) && /\b(log|ghi|hmi|thong bao|message|welcome|chao)\b/.test(t)) {
    const text = /"([^"]+)"/.exec(message)?.[1] ?? (vietnamese(message) ? "Ứng dụng đã khởi động" : "App started");
    const action: Op = /\b(hmi|thong bao|welcome|chao)\b/.test(t)
      ? { op: "add_block", ref: "a1", type: "sv_hmi_notify", name: unique("Welcome", taken), props: { severity: "info", title: "SimVehicleApp", message: text } }
      : { op: "add_block", ref: "a1", type: "sv_log", name: unique("Log start", taken), props: { level: "info", message: text } };
    return {
      ops: [{ op: "add_block", ref: "t1", type: "sv_on_app_start", name: unique("App start", taken), props: {} }, action, { op: "connect", from: "t1", fromHandle: "source", to: "a1" }],
      summary: `app start ⇒ ${action.type === "sv_hmi_notify" ? "HMI message" : "log"} "${text}"`,
    };
  }
  return null;
}

const HELP_VI =
  "(AI giả lập — SV_AI_PROVIDER=fake, không dùng model.) Tôi hiểu các yêu cầu dạng: \"Bật đèn cảnh báo nguy hiểm khi tốc độ trên 120 km/h liên tục 2 giây\", \"Cảnh báo HMI khi pin dưới 20% lúc xe đang chạy\", \"Ghi log khi ứng dụng khởi động\", \"Chạy app\". Cấu hình provider thật trong .env để có trợ lý đầy đủ.";
const HELP_EN =
  "(Simulated AI — SV_AI_PROVIDER=fake, no model.) I understand requests like: \"Turn on the hazard lights when the speed stays above 120 km/h for 2 seconds\", \"Show an HMI warning when the battery is below 20% while moving\", \"Log a message when the app starts\", \"Run the app\". Configure a real provider in .env for the full assistant.";

let seq = 0;
const toolUse = (name: string, input: Record<string, unknown>): ToolUseBlock => ({ type: "tool_use", id: `fake_${++seq}`, name, input });

function lastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]!;
    if (m.role !== "user") continue;
    if (typeof m.content === "string") return m.content;
    const text = m.content.filter((b): b is TextBlock => b.type === "text").map((b) => b.text).join("");
    if (text && !text.startsWith("[assistant runtime]")) return text;
  }
  return "";
}

export function fakeProvider(): LlmProvider {
  return {
    name: "fake",
    model: "simulated",
    async streamTurn(req: TurnRequest): Promise<TurnResult> {
      const say = (text: string): TurnResult => {
        // After a tool call the answer starts a new paragraph of the same assistant message.
        const shown = req.messages.length > 1 ? `\n\n${text}` : text;
        req.onText?.(shown);
        return { content: [{ type: "text", text: shown }], stopReason: "end_turn" };
      };
      const question = lastUserText(req.messages);
      const vi = vietnamese(question);
      const last = req.messages[req.messages.length - 1];
      const results = last && Array.isArray(last.content) ? (last.content as ContentBlock[]).filter((b) => b.type === "tool_result") : [];
      if (results.length) {
        // Answer from what the tools said, like a model would.
        const r = results[0] as { content: string; is_error?: boolean };
        const head = r.content.split("\n")[0] ?? "";
        if (/^Proposal is valid/m.test(r.content)) return say(vi ? "Đã đề xuất thay đổi — bấm \"Show on canvas\" để xem và Accept trên canvas." : "Proposed — click \"Show on canvas\" to review it, then Accept on the canvas.");
        if (/^Proposal has/m.test(r.content)) return say(vi ? `Đề xuất còn lỗi:\n${r.content.slice(0, 400)}` : `The proposal still has errors:\n${r.content.slice(0, 400)}`);
        return say(r.is_error ? (vi ? `Không thực hiện được: ${head}` : `That did not work: ${head}`) : head);
      }
      const t = fold(question);
      if (/\b(run|chay|start the app)\b/.test(t) && !/\b(when|khi)\b/.test(t)) {
        const project = /Project: id (\S+?),/.exec(req.system)?.[1];
        if (!project) return say(vi ? "Workflow chưa thuộc project nào — thêm nó vào một vehicle project rồi SynCode trước." : "This workflow is not in a vehicle project yet — add it to one and SynCode first.");
        return { content: [toolUse("run_start", { projectId: project })], stopReason: "tool_use" };
      }
      const p = plan(question, req.system);
      if (!p) return say(vi ? HELP_VI : HELP_EN);
      req.onText?.(vi ? `Đề xuất: ${p.summary}.` : `Proposal: ${p.summary}.`);
      return {
        content: [{ type: "text", text: vi ? `Đề xuất: ${p.summary}.` : `Proposal: ${p.summary}.` }, toolUse("workflow_propose_patch", { ops: p.ops, rationale: `${p.summary} (simulated AI)` })],
        stopReason: "tool_use",
      };
    },
  };
}
