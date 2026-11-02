// M28/M29 robot full flow on the real GUI, verified end to end, recorded in one take (ADR-0071, ADR-0072).
// SimVehicleApp studio → new workflow → signal catalog RSS → drag-and-drop robot blocks (and an RSS signal) → Check →
// Build → Deploy (Dog ROS sim) → Robot Zoo in a new tab → Start → the dog executes the workflow → studio Live log and
// Robot Zoo ROS log → trace checked against the design.
//   LANG_UI=en|vi   language of both GUIs (studio cookie sv-locale, Robot Zoo ?lang=)
//   MODE=regression|tutorial   tutorial: slower, a caption per step for a first-time user
//   RECORD=0|1   ffmpeg x11grab of the Xvfb screen
// Every failed check exits non-zero: such a recording is not a deliverable.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const STUDIO = process.env.STUDIO_URL || "http://localhost:3000";
const OUT = process.env.OUT || "/evidence";
const RECORD = process.env.RECORD !== "0";
const LANG = process.env.LANG_UI === "vi" ? "vi" : "en";
const TUTORIAL = process.env.MODE === "tutorial";
const W = 1600, H = 900;
const t0 = Date.now();
const chapters = [];
const checks = [];
const elapsed = () => +((Date.now() - t0) / 1000).toFixed(1);
const pause = (ms) => (TUTORIAL ? ms : Math.round(ms / 3));

/** Captions and the texts typed into the workflow, per language. */
const L = {
  en: {
    intro: "SimVehicleApp: control a robot dog with a drag-and-drop workflow",
    signup: "1. Open SimVehicleApp and create an account",
    newWf: "2. Create a workflow and name it",
    wfName: "Dog patrol",
    catalog: "3. Toolbar → Signals: choose RSS (robot dog) — the palette now shows the robot blocks only",
    tree: "4. The robot's signals (RSS): e.g. Perception → Marker → IsDetected",
    drag: "5. Drag robot blocks from the Toolbar onto the canvas",
    signal: "6. Drag a robot signal onto the canvas → Wait until (the condition is filled in)",
    names: "Block names default to English; rename them freely",
    props: "7. Set each block: conditions on RSS signals, motions, coordinates, log messages",
    links: "8. Connect the named outputs: done / failed, then / else, loop / after loop",
    check: "9. Problems: the RobotFlow compiler checks the workflow as you edit — no errors",
    build: "10. Build: the compiler turns the workflow into a Python robot app (same input, same bytes)",
    deploy: "11. Deploy to Dog ROS sim — binds the build to the robot; nothing runs yet",
    zoo: "12. Robot Zoo opens in a new tab (the dog simulation, its own repository)",
    zooReady: "Robot Zoo: simulated Go2 dog (ROS 2 + MuJoCo), DISARMED",
    start: "13. Start (with confirmation): the workflow drives the robot through RSS → Protobus → ROS 2",
    watch: "The robot follows the workflow: Arm → sees the marker → Bow → Lift paw → Jump → patrol twice",
    studioLive: "Studio, Live tab: the running block is outlined; each robot command with its result and request id",
    zooLogs: "Robot Zoo, Logs & diagnostics: the robot's own ROS log of the same commands",
    result: "14. Result: every command SUCCEEDED, the run finished by itself, the robot is DISARMED again",
    end: "Done — Stop is always available in the studio and in Robot Zoo",
    n: {
      start: "Start", hello: "Log start", arm: "Arm robot", battery: "Battery ≥ 20 %?", see: "Wait for red marker", bow: "Bow",
      paw: "Wave paw", jump: "Jump", patrol: "Patrol twice", out: "Go out (1.0, 0)", back: "Come back (0.3, 0)", done: "Log done",
      rest: "Disarm", low: "Log low battery", fail: "Log failure", halt: "Emergency stop",
    },
    msg: {
      hello: "Scenario starts, battery {{Robot.PowerSystem.Battery.StateOfCharge}} %",
      done: "Patrol done, x = {{Robot.Pose.Position.X}} m",
      low: "Battery low {{Robot.PowerSystem.Battery.StateOfCharge}} % — scenario skipped",
      fail: "A step failed — stopping safely",
    },
    motion: { BOW: "Bow", LIFT_FRONT_LEFT: "Lift front-left paw", JUMP: "Jump" },
  },
  vi: {
    intro: "Hướng dẫn: điều khiển robot dog bằng workflow kéo thả trong SimVehicleApp",
    signup: "1. Mở SimVehicleApp, chọn Tiếng Việt và tạo tài khoản",
    newWf: "2. Tạo một workflow mới và đặt tên",
    wfName: "Tuần tra robot dog",
    catalog: "3. Thanh công cụ → Tín hiệu: chọn RSS (robot dog) — palette chỉ còn các block robot",
    tree: "4. Cây tín hiệu của robot (RSS): ví dụ Perception → Marker → IsDetected (đã thấy marker đỏ)",
    drag: "5. Kéo các block robot từ Thanh công cụ thả vào canvas",
    signal: "6. Kéo một tín hiệu robot vào canvas → chọn “Chờ đến khi” (điều kiện được điền sẵn)",
    names: "Tên block mặc định là tiếng Anh; bạn có thể đổi sang tiếng Việt tuỳ ý",
    props: "7. Thiết lập từng block: điều kiện theo tín hiệu RSS, động tác, toạ độ, nội dung log",
    links: "8. Nối các cổng có tên: xong / lỗi, đúng / sai, lặp / xong lặp",
    check: "9. Tab Vấn đề: compiler RobotFlow tự kiểm tra khi bạn sửa — không còn lỗi",
    build: "10. Biên dịch: compiler sinh app robot Python (cùng đầu vào, cùng kết quả)",
    deploy: "11. Triển khai lên Dog ROS sim — gắn bản biên dịch với robot, chưa chạy gì",
    zoo: "12. Robot Zoo mở ở tab mới (mô phỏng robot dog, repo riêng)",
    zooReady: "Robot Zoo: robot Go2 mô phỏng (ROS 2 + MuJoCo), đang DISARMED",
    start: "13. Chạy (có xác nhận): workflow điều khiển robot qua RSS → Protobus → ROS 2",
    watch: "Robot làm đúng workflow: Arm → thấy marker → Cúi chào → Giơ chân → Nhảy → tuần tra 2 vòng",
    studioLive: "Studio, tab Trực tiếp: block đang chạy có viền sáng; từng lệnh robot kèm kết quả và request id",
    zooLogs: "Robot Zoo, Log & chẩn đoán: log ROS của chính robot cho cùng các lệnh",
    result: "14. Kết quả: mọi lệnh SUCCEEDED, lượt chạy tự kết thúc, robot về DISARMED",
    end: "Xong — nút Dừng luôn có trong studio và trong Robot Zoo",
    n: {
      start: "Bắt đầu", hello: "Log bắt đầu", arm: "Arm robot", battery: "Pin ≥ 20 %?", see: "Chờ thấy marker đỏ", bow: "Cúi chào",
      paw: "Giơ chân chào", jump: "Nhảy", patrol: "Tuần tra 2 vòng", out: "Đi ra (1.0, 0)", back: "Quay về (0.3, 0)", done: "Log hoàn tất",
      rest: "Disarm", low: "Log pin yếu", fail: "Log lỗi", halt: "Dừng khẩn",
    },
    msg: {
      hello: "Bắt đầu kịch bản, pin {{Robot.PowerSystem.Battery.StateOfCharge}} %",
      done: "Hoàn tất tuần tra, x = {{Robot.Pose.Position.X}} m",
      low: "Pin yếu {{Robot.PowerSystem.Battery.StateOfCharge}} % — không chạy kịch bản",
      fail: "Bước thất bại — dừng an toàn",
    },
    motion: { BOW: "Cúi chào", LIFT_FRONT_LEFT: "Giơ chân trước trái", JUMP: "Nhảy" },
  },
}[LANG];

const POINTER = `(() => { const install = () => { if (document.getElementById('rf-pointer')) return;
  const el = document.createElement('div'); el.id = 'rf-pointer';
  el.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  Object.assign(el.style, {position:'fixed',left:'-50px',top:'-50px',zIndex:2147483647,pointerEvents:'none'});
  const cap = document.createElement('div'); cap.id = 'rf-caption'; cap.setAttribute('data-sv-no-translate', ''); cap.setAttribute('data-no-translate', '');
  Object.assign(cap.style, {position:'fixed',left:'50%',bottom:'14px',transform:'translateX(-50%)',zIndex:2147483646,pointerEvents:'none',
    background:'rgba(17,24,39,.9)',color:'#fff',font:'600 18px system-ui,sans-serif',padding:'9px 18px',borderRadius:'10px',maxWidth:'82%',textAlign:'center',display:'none'});
  document.body.appendChild(cap); document.body.appendChild(el);
  addEventListener('mousemove', e => { el.style.left = e.clientX - 4 + 'px'; el.style.top = e.clientY - 3 + 'px'; }, true);
  window.__rfCaption = (t) => { cap.textContent = t; cap.style.display = t ? 'block' : 'none'; };
  const saved = sessionStorage.getItem('rf-caption'); if (saved) window.__rfCaption(saved); };
  if (document.body) install(); else addEventListener('DOMContentLoaded', install); })()`;

async function caption(page, text, hold = 0) {
  chapters.push({ t: elapsed(), text });
  console.log(`[${elapsed()}s] ${text}`);
  await page.evaluate((t) => { sessionStorage.setItem("rf-caption", t); window.__rfCaption?.(t); }, text).catch(() => {});
  if (hold) await page.waitForTimeout(pause(hold));
}
async function glide(page, locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await locator.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: TUTORIAL ? 26 : 16 });
  await page.waitForTimeout(TUTORIAL ? 350 : 200);
}
async function click(page, locator) { await glide(page, locator); await locator.click(); }
async function type(page, locator, text) {
  await click(page, locator);
  await locator.fill("");
  if (/[{<]/.test(text) || text.length > 70) await locator.fill(text);
  else await locator.pressSequentially(text, { delay: TUTORIAL ? 45 : 30 });
  await page.waitForTimeout(250);
}
function check(condition, message) {
  if (!condition) throw new Error("CHECK FAILED: " + message);
  checks.push(message);
  console.log("check ok:", message);
}

// ---------------------------------------------------------------- recording
let ffmpeg = null;
if (RECORD) {
  ffmpeg = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-framerate", "25", "-video_size", `${W}x${H}`,
    "-i", process.env.DISPLAY, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", `${OUT}/robot-flow.mp4`],
    { stdio: ["pipe", "inherit", "inherit"] });
}

const browser = await chromium.launch({
  headless: false,
  args: ["--window-position=0,0", `--window-size=${W},${H}`, "--start-maximized", "--no-first-run", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--disable-renderer-backgrounding",
    "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
    // no "translate this page?" bubble: both GUIs translate themselves
    "--disable-features=Translate,TranslateUI", `--lang=${LANG === "vi" ? "vi-VN" : "en-US"}`],
});
const context = await browser.newContext({ viewport: null });
await context.addInitScript(POINTER);
const page = await context.newPage();
page.setDefaultTimeout(60000);
let zoo = null;
let exitCode = 0;
const result = { lang: LANG, mode: TUTORIAL ? "tutorial" : "regression", chapters, checks };

try {
  // ---------------------------------------------------------- 1. account, in the chosen language
  await page.goto(STUDIO + "/signup", { waitUntil: "networkidle", timeout: 120000 });
  await caption(page, L.intro, 4000);
  await caption(page, L.signup);
  if (LANG === "vi") {
    await click(page, page.locator('[data-sv-locale="vi"]'));
    await page.waitForLoadState("networkidle");
    await caption(page, L.signup, 1500);
  }
  const run = Date.now().toString(36);
  await type(page, page.locator("#name"), LANG === "vi" ? "Nguoi Dung Demo" : "Robot Demo");
  await type(page, page.locator("#email"), `robot-${LANG}-${run}@example.com`);
  await type(page, page.locator("#password"), `Robot-${run}-Pass-2026!`);
  const [signup] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/sign-up/email"), { timeout: 60000 }),
    click(page, page.locator('button[type="submit"]')),
  ]);
  check(signup.status() === 200, "sign-up accepted");
  await page.waitForURL(/\/workspace\/[^/]+\/w\/[^/?]+/, { timeout: 300000, waitUntil: "domcontentloaded" });
  const settings = await page.request.patch(STUDIO + "/api/users/me/settings", { data: { autoConnect: false } });
  check(settings.ok(), "auto-connect off (every link is drawn by hand)");
  await page.reload({ waitUntil: "networkidle", timeout: 300000 });
  await page.locator(".react-flow__renderer").waitFor({ timeout: 300000 });

  // ---------------------------------------------------------- 2. a new workflow, named
  await caption(page, L.newWf);
  const firstWf = new URL(page.url()).pathname;
  // the "+" next to Workflows in the sidebar (right after the Workflow options button)
  const options = await page.locator('button:has(svg.lucide-ellipsis[class*="h-[16px]"])').first().boundingBox();
  await page.mouse.move(options.x + options.width / 2 + 26, options.y + options.height / 2, { steps: TUTORIAL ? 26 : 16 });
  await page.waitForTimeout(TUTORIAL ? 600 : 250);
  await page.mouse.click(options.x + options.width / 2 + 26, options.y + options.height / 2);
  await page.waitForURL((u) => u.pathname !== firstWf && /\/w\/[^/?]+$/.test(u.pathname), { timeout: 60000 });
  await page.locator(".react-flow__renderer").waitFor();
  await page.waitForTimeout(pause(1500));
  const workflowId = /\/w\/([^/?]+)/.exec(page.url())[1];
  const wfItem = page.locator(`a[data-item-id="${workflowId}"]`).first();
  await glide(page, wfItem);
  await wfItem.click({ button: "right" });
  await page.waitForTimeout(pause(900));
  await click(page, page.getByRole("menuitem", { name: /^(Rename|Đổi tên)$/ }).first());
  const wfInput = page.locator("input:focus");
  await wfInput.fill("");
  await wfInput.pressSequentially(L.wfName, { delay: TUTORIAL ? 60 : 30 });
  await wfInput.press("Enter");
  await page.waitForTimeout(pause(1500));

  // ---------------------------------------------------------- 3. RSS signal catalog → robot palette
  await page.locator('[data-tab-button="toolbar"]').click();
  await caption(page, L.catalog);
  const picker = page.locator('[data-sv="vss-release-picker"]');
  await click(page, picker.getByRole("button"));
  await page.waitForTimeout(pause(1200));
  await click(page, page.getByRole("menuitem", { name: /RSS/ }));
  await page.waitForFunction(() => document.querySelector('[data-sv="vss-release-picker"]')?.dataset.svDomain === "robot", null, { timeout: 30000 });
  check(await page.locator('[data-sv-block-type="rf_on_start"]').count() > 0 && await page.locator('[data-sv-block-type^="sv_"]').count() === 0,
    "RSS chosen: the palette shows robot blocks and no vehicle block");
  await page.waitForTimeout(pause(2500));

  // ---------------------------------------------------------- 4. the RSS signal tree
  await caption(page, L.tree);
  for (const path of ["Robot.Perception", "Robot.Perception.Marker"]) {
    const row = page.locator(`[data-sv="vehicle-panel"] [data-sv-path="${path}"]`).first();
    await click(page, row);
    await page.waitForTimeout(pause(900));
  }
  const markerRow = page.locator('[data-sv="vehicle-panel"] [data-sv-panel-path="Robot.Perception.Marker.IsDetected"]').first();
  await glide(page, markerRow);
  await page.waitForTimeout(pause(2500));

  // ---------------------------------------------------------- 5. robot blocks onto the canvas
  await caption(page, L.drag);
  const pane = page.locator(".react-flow__pane");
  const node = (name) => page.locator(".react-flow__node").filter({ has: page.locator(`[title="${name}"]`) }).first();
  const editor = page.locator('[data-tab-content="editor"]');
  const X = [12, 252, 492, 732], Y = [8, 132, 256, 380];
  const layout = [
    ["start", "rf_on_start", X[0], Y[0]], ["hello", "rf_log", X[1], Y[0]], ["arm", "rf_arm", X[2], Y[0]], ["battery", "rf_if", X[3], Y[0]],
    ["see", "signal", X[0], Y[1]], ["bow", "rf_perform", X[1], Y[1]], ["paw", "rf_perform", X[2], Y[1]], ["jump", "rf_perform", X[3], Y[1]],
    ["patrol", "rf_repeat", X[0], Y[2]], ["out", "rf_go_to", X[1], Y[2]], ["back", "rf_go_to", X[2], Y[2]], ["done", "rf_log", X[3], Y[2]],
    ["rest", "rf_disarm", X[0], Y[3]], ["low", "rf_log", X[1], Y[3]], ["fail", "rf_log", X[2], Y[3]], ["halt", "rf_stop", X[3], Y[3]],
  ];
  async function zoomOut() {
    const box = await pane.boundingBox();
    await page.mouse.move(box.x + X[0] + 5, box.y + Y[0] + 5, { steps: 12 });
    for (let i = 0; i < 12; i++) {
      const scale = await page.evaluate(() => {
        const m = /scale\(([\d.]+)\)/.exec(document.querySelector(".react-flow__viewport")?.style.transform ?? "");
        return m ? Number(m[1]) : 1;
      });
      if (scale <= 0.62) return scale;
      await page.keyboard.down("Control");
      await page.mouse.wheel(0, 60);
      await page.keyboard.up("Control");
      await page.waitForTimeout(200);
    }
    return null;
  }
  async function rename(name) {
    await page.locator('[data-tab-button="editor"]').click();
    await editor.locator("h2").first().dblclick();
    const input = editor.locator('input[type="text"]').first();
    await input.fill("");
    await input.pressSequentially(name, { delay: TUTORIAL ? 35 : 20 });
    await input.press("Enter");
    await page.waitForTimeout(200);
  }
  for (const [key, type_, x, y] of layout) {
    const before = await page.locator(".react-flow__node").count();
    const paneBox = await pane.boundingBox();
    if (type_ === "signal") {
      // An RSS signal dropped on the canvas offers When / If / Wait until with its condition filled in.
      await caption(page, L.signal);
      await page.locator('[data-tab-button="toolbar"]').click();
      await glide(page, markerRow);
      await markerRow.dragTo(pane, { targetPosition: { x, y }, force: true });
      const menu = page.locator('[data-sv="signal-drop-menu"]');
      await menu.waitFor();
      await page.waitForTimeout(pause(1800));
      await click(page, menu.locator('[data-sv-block="rf_wait_until"]'));
      await page.locator(".react-flow__node").nth(before).waitFor();
      check(true, "RSS signal dropped → Wait until block with the condition preset");
      await caption(page, L.drag);
    } else {
      await page.locator('[data-tab-button="toolbar"]').click();
      const item = page.locator(`[data-tab-content="toolbar"] [data-sv-block-type="${type_}"]`).first();
      await glide(page, item);
      await item.dragTo(pane, { targetPosition: { x, y }, force: true });
      await page.locator(".react-flow__node").nth(before).waitFor();
    }
    await page.mouse.move(paneBox.x + x + 60, paneBox.y + y + 20, { steps: 10 });
    if (key === "hello" && TUTORIAL) await caption(page, L.names, 2500);
    await rename(L.n[key]);
    if (key === "hello" && TUTORIAL) await caption(page, L.drag);
    if (key === "start") check((await zoomOut()) !== null, "canvas zoomed out to fit the workflow");
  }
  check((await page.locator(".react-flow__node").count()) >= 16, "16 robot blocks on the canvas");
  await click(page, page.locator("button:has(svg.lucide-scan)").first());
  await page.waitForTimeout(pause(1500));

  // ---------------------------------------------------------- 7. properties
  await caption(page, L.props);
  const sub = (id) => editor.locator(`[data-workflow-search-subblock-id="${id}"]`);
  async function select(key) {
    await click(page, node(L.n[key]).locator("[title]").first());
    await page.locator('[data-tab-button="editor"]').click();
  }
  async function text(id, value) { await type(page, sub(id).locator("textarea, input").first(), value); }
  async function choose(id, label) {
    await click(page, sub(id).locator('button, [role="combobox"]').first());
    const exact = new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
    await click(page, page.getByRole("option", { name: exact }).first());
  }
  await select("hello"); await text("message", L.msg.hello);
  await select("battery"); await text("when", "Robot.PowerSystem.Battery.StateOfCharge >= 20 %");
  await select("see");
  check((await sub("when").locator("textarea, input").first().inputValue()) === "Robot.Perception.Marker.IsDetected == true",
    "the dropped signal preset the condition Robot.Perception.Marker.IsDetected == true");
  await text("timeoutMs", "10000");
  await select("bow"); await choose("name", L.motion.BOW);
  await select("paw"); await choose("name", L.motion.LIFT_FRONT_LEFT);
  await select("jump"); await choose("name", L.motion.JUMP);
  await select("patrol"); await text("count", "2");
  await select("out"); await text("x", "1.0"); await text("y", "0");
  await select("back"); await text("x", "0.3"); await text("y", "0");
  await select("done"); await text("message", L.msg.done);
  await select("low"); await choose("level", "warn"); await text("message", L.msg.low);
  await select("fail"); await choose("level", "error"); await text("message", L.msg.fail);

  // ---------------------------------------------------------- 8. links (named ports)
  await caption(page, L.links);
  async function link(from, port, to) {
    const src = node(L.n[from]).locator(`.react-flow__handle[data-handleid="${port}"]`).first();
    const dst = node(L.n[to]).locator(".react-flow__handle.target").first();
    const edges = await page.locator(".react-flow__edge").count();
    const a = await src.boundingBox(), b = await dst.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 15 });
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 10 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
    try {
      await page.waitForFunction((n) => document.querySelectorAll(".react-flow__edge").length > n, edges, { timeout: 5000 });
    } catch {
      await page.screenshot({ path: `${OUT}/link-fail.png` });
      throw new Error(`link ${from}.${port} → ${to} not created (src ${JSON.stringify(a)} dst ${JSON.stringify(b)})`);
    }
  }
  const links = [["start", "next", "hello"], ["hello", "next", "arm"], ["arm", "ok", "battery"], ["battery", "then", "see"],
    ["battery", "else", "low"], ["low", "next", "rest"], ["see", "next", "bow"], ["see", "timeout", "bow"], ["bow", "ok", "paw"],
    ["paw", "ok", "jump"], ["jump", "ok", "patrol"], ["patrol", "body", "out"], ["out", "ok", "back"], ["back", "ok", "patrol"],
    ["patrol", "done", "done"], ["done", "next", "rest"], ["arm", "failed", "fail"], ["bow", "failed", "fail"],
    ["paw", "failed", "fail"], ["jump", "failed", "fail"], ["out", "failed", "fail"], ["back", "failed", "fail"], ["fail", "next", "halt"]];
  for (const [a, p, b] of links) await link(a, p, b);
  check((await page.locator(".react-flow__edge").count()) === links.length, `${links.length} links drawn`);
  await page.mouse.click((await pane.boundingBox()).x + 1000, (await pane.boundingBox()).y + 500);

  // ---------------------------------------------------------- 9. check, build, deploy
  await caption(page, L.check);
  await click(page, page.locator('[data-sv-tab="problems"]'));
  await page.waitForFunction(() => /^OK/.test(document.querySelector("[data-rf-check]")?.textContent?.trim() ?? ""), null, { timeout: 30000 });
  check(true, "robot check OK (no errors)");
  await page.waitForTimeout(pause(3000));
  await caption(page, L.build);
  const [build] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/sv/robotics/builds"), { timeout: 60000 }),
    click(page, page.locator('[data-rf-action="build"]')),
  ]);
  const buildBody = await build.json();
  check(build.ok() && buildBody.ok, "build ok " + buildBody.build?.artifactHash);
  result.artifactHash = buildBody.build.artifactHash;
  await page.waitForTimeout(pause(3500));
  await caption(page, L.deploy);
  const [deploy] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/sv/robotics/deployments"), { timeout: 60000 }),
    click(page, page.locator('[data-rf-action="deploy"]')),
  ]);
  const deployment = await deploy.json();
  check(deploy.ok() && deployment.mode === "ros-sim" && deployment.target.providers.some((p) => p.startsWith("ros2-")),
    "deployed to ros-sim with the ROS 2 bridge attached");
  result.deployment = { id: deployment.id, target: deployment.target };
  await page.waitForTimeout(pause(3500));

  // ---------------------------------------------------------- 12. Robot Zoo in a new tab, then Start
  await caption(page, L.zoo);
  const [zooPage] = await Promise.all([context.waitForEvent("page"), click(page, page.locator('[data-rf-action="zoo"]'))]);
  zoo = zooPage;
  await zoo.waitForLoadState("domcontentloaded");
  check(new URL(zoo.url()).searchParams.get("lang") === LANG, `Robot Zoo opened in the studio's language (${LANG})`);
  await zoo.waitForFunction(() => document.getElementById("world3d")?.dataset.ready === "true", null, { timeout: 90000 });
  await caption(zoo, L.zooReady, 5000);
  await page.bringToFront();
  await caption(page, L.start);
  await click(page, page.locator('[data-rf-action="start"]'));
  await page.waitForTimeout(pause(2500));
  const [start] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/sv/robotics/runs") && r.request().method() === "POST", { timeout: 60000 }),
    click(page, page.locator('[data-rf-action="confirm-start"]')),
  ]);
  const runInfo = await start.json();
  check(start.ok() && runInfo.state === "running", "run started " + runInfo.id);
  await page.waitForTimeout(6000);
  await zoo.bringToFront();
  await caption(zoo, L.watch);
  let state = "running";
  let shownLogs = false;
  for (let i = 0; i < 48 && state === "running"; i++) {
    if (i % 4 === 3) {
      await page.bringToFront();
      await caption(page, L.studioLive);
      await page.waitForTimeout(5000);
      if (!shownLogs && i >= 7) {
        // Robot Zoo's own ROS log, then back to the 3D view
        shownLogs = true;
        await zoo.bringToFront();
        await caption(zoo, L.zooLogs);
        await click(zoo, zoo.locator("#tab-logs"));
        const expand = zoo.locator("#context-expand");
        if (await expand.isVisible().catch(() => false)) await click(zoo, expand);
        await zoo.waitForTimeout(8000);
        if (await expand.isVisible().catch(() => false)) await click(zoo, expand);
        await click(zoo, zoo.locator("#tab-scene"));
      }
      await zoo.bringToFront();
      await caption(zoo, L.watch);
    } else await zoo.waitForTimeout(5000);
    const status = await page.request.get(`${STUDIO}/api/sv/robotics/runs/${runInfo.id}`);
    state = (await status.json()).state;
  }
  await page.bringToFront();
  await caption(page, L.result);
  const final = await (await page.request.get(`${STUDIO}/api/sv/robotics/runs/${runInfo.id}`)).json();
  const started = final.events.filter((e) => e.ev === "node" && e.state === "started").map((e) => e.node);
  const ids = Object.fromEntries(await Promise.all(Object.entries(L.n).map(async ([key, name]) => [await node(name).getAttribute("data-id"), key])));
  const order = started.map((id) => ids[id] ?? id);
  const commands = final.events.filter((e) => e.ev === "command" && ["SUCCEEDED", "FAILED", "REJECTED", "TIMED_OUT", "CANCELLED"].includes(e.phase))
    .map((e) => ({ node: ids[e.node] ?? e.node, path: e.path, phase: e.phase, requestId: e.requestId, message: e.message }));
  result.run = { id: runInfo.id, state: final.state, order, commands, logs: final.events.filter((e) => e.ev === "log").map((e) => e.message) };
  check(final.state === "finished", "run finished by itself");
  check(JSON.stringify(order) === JSON.stringify(["hello", "arm", "battery", "see", "bow", "paw", "jump", "patrol", "out", "back", "patrol", "out", "back", "patrol", "done", "rest"]),
    "execution order equals the workflow design: " + order.join(" → "));
  check(commands.length === 9 && commands.every((c) => c.phase === "SUCCEEDED"), "all 9 robot commands SUCCEEDED (measured robot state)");
  await page.locator("[data-rf-timeline]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(pause(9000));
  await zoo.bringToFront();
  await caption(zoo, L.end, 6000);
} catch (error) {
  exitCode = error?.planned ? 0 : 1;
  result.error = String(error?.stack || error).slice(0, 2000);
  console.error(result.error);
  await page.screenshot({ path: `${OUT}/failure.png` }).catch(() => {});
} finally {
  result.durationS = elapsed();
  if (ffmpeg) {
    ffmpeg.stdin.write("q");
    await new Promise((r) => ffmpeg.on("exit", r));
  }
  await fs.writeFile(`${OUT}/run-result.json`, JSON.stringify(result, null, 1));
  await browser.close();
  process.exit(exitCode);
}
