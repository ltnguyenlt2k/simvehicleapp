// M28 full-flow E2E + honest recording (ADR-0071).
// Real SimVehicleApp studio (GUI) → drag-and-drop robot workflow → Build → Deploy (Dog ROS sim) → Start →
// Robot Zoo opened in a new tab shows the dog executing the workflow → trace checked against the design.
// Runs inside robotics/recorder on an Xvfb screen; ffmpeg x11grab records the whole screen in one take.
// Every check that fails exits non-zero: such a recording is not a deliverable.
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const STUDIO = process.env.STUDIO_URL || "http://localhost:3000";
const OUT = process.env.OUT || "/evidence";
const RECORD = process.env.RECORD !== "0";
const W = 1600, H = 900;
const t0 = Date.now();
const chapters = [];
const checks = [];
const elapsed = () => +((Date.now() - t0) / 1000).toFixed(1);

const POINTER = `(() => { const install = () => { if (document.getElementById('rf-pointer')) return;
  const el = document.createElement('div'); el.id = 'rf-pointer';
  el.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M3 2l7 19 2.6-7.6L20 11z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
  Object.assign(el.style, {position:'fixed',left:'-50px',top:'-50px',zIndex:2147483647,pointerEvents:'none'});
  const cap = document.createElement('div'); cap.id = 'rf-caption';
  Object.assign(cap.style, {position:'fixed',left:'50%',bottom:'14px',transform:'translateX(-50%)',zIndex:2147483646,pointerEvents:'none',
    background:'rgba(17,24,39,.88)',color:'#fff',font:'600 17px system-ui,sans-serif',padding:'8px 16px',borderRadius:'10px',maxWidth:'80%',textAlign:'center',display:'none'});
  document.body.appendChild(cap); document.body.appendChild(el);
  addEventListener('mousemove', e => { el.style.left = e.clientX - 4 + 'px'; el.style.top = e.clientY - 3 + 'px'; }, true);
  window.__rfCaption = (t) => { cap.textContent = t; cap.style.display = t ? 'block' : 'none'; };
  const saved = sessionStorage.getItem('rf-caption'); if (saved) window.__rfCaption(saved); };
  if (document.body) install(); else addEventListener('DOMContentLoaded', install); })()`;

async function caption(page, text) {
  chapters.push({ t: elapsed(), text });
  console.log(`[${elapsed()}s] ${text}`);
  await page.evaluate((t) => { sessionStorage.setItem("rf-caption", t); window.__rfCaption?.(t); }, text).catch(() => {});
}

async function glide(page, locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  const box = await locator.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 22 });
  await page.waitForTimeout(250);
}
async function click(page, locator) { await glide(page, locator); await locator.click(); }
async function type(page, locator, text) {
  await click(page, locator);
  await locator.fill("");
  if (/[{<]/.test(text) || text.length > 70) await locator.fill(text);
  else await locator.pressSequentially(text, { delay: 35 });
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
    "-i", process.env.DISPLAY, "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-pix_fmt", "yuv420p", `${OUT}/robot-full-flow.mp4`],
    { stdio: ["pipe", "inherit", "inherit"] });
}

const browser = await chromium.launch({
  headless: false,
  args: ["--window-position=0,0", `--window-size=${W},${H}`, "--start-maximized", "--no-first-run", "--disable-dev-shm-usage",
    "--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows", "--hide-crash-restore-bubble", "--disable-infobars"],
});
const context = await browser.newContext({ viewport: null });
await context.addInitScript(POINTER);
const page = await context.newPage();
page.setDefaultTimeout(60000);
let zoo = null;
let exitCode = 0;
const result = { chapters, checks };

try {
  // ---------------------------------------------------------- 1. sign up in the existing studio
  const run = Date.now().toString(36);
  await page.goto(STUDIO + "/signup", { waitUntil: "networkidle", timeout: 120000 });
  await caption(page, "1. GUI SimVehicleApp hiện có — đăng ký tài khoản");
  await type(page, page.locator("#name"), "Robot Demo");
  await type(page, page.locator("#email"), `robot-demo-${run}@example.com`);
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
  const workflowId = /\/w\/([^/?]+)/.exec(page.url())[1];

  // ---------------------------------------------------------- 2. drag-and-drop the workflow
  await caption(page, "2. Kéo thả block Robot từ Toolbar (cùng palette với block xe)");
  const pane = page.locator(".react-flow__pane");
  const node = (name) => page.locator(".react-flow__node").filter({ has: page.locator(`[title="${name}"]`) }).first();
  const editor = page.locator('[data-tab-content="editor"]');
  const X = [12, 252, 492, 732], Y = [8, 132, 256, 380];
  const layout = [
    ["start", "Khi bắt đầu", X[0], Y[0]], ["hello", "Ghi log", X[1], Y[0]], ["arm", "Arm (sẵn sàng)", X[2], Y[0]], ["battery", "Nếu / Không thì", X[3], Y[0]],
    ["see", "Chờ đến khi", X[0], Y[1]], ["bow", "Thực hiện động tác", X[1], Y[1]], ["paw", "Thực hiện động tác", X[2], Y[1]], ["jump", "Thực hiện động tác", X[3], Y[1]],
    ["patrol", "Lặp N lần", X[0], Y[2]], ["out", "Đi tới điểm", X[1], Y[2]], ["back", "Đi tới điểm", X[2], Y[2]], ["done", "Ghi log", X[3], Y[2]],
    ["rest", "Disarm", X[0], Y[3]], ["low", "Ghi log", X[1], Y[3]], ["fail", "Ghi log", X[2], Y[3]], ["halt", "Dừng khẩn (Stop)", X[3], Y[3]],
  ];
  /** Zoom out like a user (Ctrl + wheel, only effective once a block exists) around the first block: scale ≈ 0.6. */
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
  const names = {
    start: "Khi bắt đầu", hello: "Log bắt đầu", arm: "Arm robot", battery: "Pin ≥ 20 %?", see: "Chờ thấy marker đỏ",
    bow: "Cúi chào", paw: "Giơ chân chào", jump: "Nhảy", patrol: "Tuần tra 2 vòng", out: "Đi ra (1.0, 0)", back: "Quay về (0.3, 0)",
    done: "Log hoàn tất", rest: "Disarm", low: "Log pin yếu", fail: "Log lỗi", halt: "Dừng khẩn",
  };
  for (const [key, block, x, y] of layout) {
    await page.locator('[data-tab-button="toolbar"]').click();
    const item = page.locator('[data-tab-content="toolbar"]').getByRole("button", { name: `Add ${block}`, exact: true }).first();
    await glide(page, item);
    const before = await page.locator(".react-flow__node").count();
    const paneBox = await pane.boundingBox();
    await item.dragTo(pane, { targetPosition: { x, y }, force: true });
    await page.mouse.move(paneBox.x + x + 60, paneBox.y + y + 20, { steps: 10 });
    await page.locator(".react-flow__node").nth(before).waitFor();
    // rename the new block (editor header) so the trace and the panel read like the design
    const title = editor.locator("h2").first();
    await page.locator('[data-tab-button="editor"]').click();
    await title.dblclick();
    const input = editor.locator('input[type="text"]').first();
    await input.fill("");
    await input.pressSequentially(names[key], { delay: 25 });
    await input.press("Enter");
    await page.waitForTimeout(200);
    if (key === "start") check((await zoomOut()) !== null, "canvas zoomed out to fit the workflow");
  }
  check((await page.locator(".react-flow__node").count()) >= 16, "16 robot blocks on the canvas");
  const fit = page.locator("button:has(svg.lucide-scan)").first();
  await click(page, fit);
  await page.waitForTimeout(800);

  // ---------------------------------------------------------- 3. properties
  await caption(page, "3. Cấu hình block: điều kiện theo tín hiệu RSS, động tác, toạ độ, log");
  const sub = (id) => editor.locator(`[data-workflow-search-subblock-id="${id}"]`);
  async function select(key) { await click(page, node(names[key]).locator("[title]").first()); await page.locator('[data-tab-button="editor"]').click(); }
  async function text(id, value) { const field = sub(id).locator("textarea, input").first(); await type(page, field, value); }
  async function choose(id, label) {
    await click(page, sub(id).locator('button, [role="combobox"]').first());
    await click(page, page.getByRole("option", { name: label }).first());
  }
  await select("hello"); await text("message", "Bắt đầu kịch bản, pin {{Robot.PowerSystem.Battery.StateOfCharge}} %");
  await select("battery"); await text("when", "Robot.PowerSystem.Battery.StateOfCharge >= 20 %");
  await select("see"); await text("when", "Robot.Perception.Marker.IsDetected == true"); await text("timeoutMs", "10000");
  await select("bow"); await choose("name", "Cúi chào");
  await select("paw"); await choose("name", "Giơ chân trước trái");
  await select("jump"); await choose("name", "Nhảy");
  await select("patrol"); await text("count", "2");
  await select("out"); await text("x", "1.0"); await text("y", "0");
  await select("back"); await text("x", "0.3"); await text("y", "0");
  await select("done"); await text("message", "Hoàn tất tuần tra, x = {{Robot.Pose.Position.X}} m");
  await select("low"); await choose("level", "warn"); await text("message", "Pin yếu {{Robot.PowerSystem.Battery.StateOfCharge}} % — không chạy kịch bản");
  await select("fail"); await choose("level", "error"); await text("message", "Bước thất bại — dừng an toàn");

  // ---------------------------------------------------------- 4. links (named ports)
  await caption(page, "4. Nối các cổng: xong / lỗi, đúng / sai, lặp / xong lặp, hết giờ");
  async function link(from, port, to) {
    const src = node(names[from]).locator(`.react-flow__handle[data-handleid="${port}"]`).first();
    const dst = node(names[to]).locator(".react-flow__handle.target").first();
    const edges = await page.locator(".react-flow__edge").count();
    const a = await src.boundingBox(), b = await dst.boundingBox();
    await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2, { steps: 15 });
    await page.mouse.down();
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 10 });
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 10 });
    await page.mouse.up();
    try {
      await page.waitForFunction((n) => document.querySelectorAll(".react-flow__edge").length > n, edges, { timeout: 5000 });
    } catch (error) {
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
  if (process.env.UNTIL === "links") {
    await page.waitForFunction(() => /^OK/.test(document.querySelector("[data-rf-check]")?.textContent?.trim() ?? ""), null, { timeout: 30000 });
    await page.screenshot({ path: `${OUT}/authoring.png` });
    throw Object.assign(new Error("UNTIL=links reached"), { planned: true });
  }

  // ---------------------------------------------------------- 5. check, build, deploy
  await caption(page, "5. Kiểm tra RobotFlow tự động (compiler) — 0 lỗi");
  await page.waitForFunction(() => /^OK/.test(document.querySelector("[data-rf-check]")?.textContent?.trim() ?? ""), null, { timeout: 30000 });
  check(true, "robot check OK (no errors)");
  await caption(page, "6. Build: compiler sinh app Python tất định (artifact hash)");
  const [build] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/sv/robotics/builds"), { timeout: 60000 }),
    click(page, page.locator('[data-rf-action="build"]')),
  ]);
  const buildBody = await build.json();
  check(build.ok() && buildBody.ok, "build ok " + buildBody.build?.artifactHash);
  result.artifactHash = buildBody.build.artifactHash;
  await page.waitForTimeout(1500);
  await caption(page, "7. Deploy lên Dog ROS sim — gắn bản build với robot thật, chưa chạy gì");
  const [deploy] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/sv/robotics/deployments"), { timeout: 60000 }),
    click(page, page.locator('[data-rf-action="deploy"]')),
  ]);
  const deployment = await deploy.json();
  check(deploy.ok() && deployment.mode === "ros-sim" && deployment.target.providers.some((p) => p.startsWith("ros2-")), "deployed to ros-sim with the ROS 2 bridge attached");
  result.deployment = { id: deployment.id, target: deployment.target };
  await page.waitForTimeout(1500);

  // ---------------------------------------------------------- 6. Robot Zoo in a new tab, then Start
  await caption(page, "8. Mở Robot Zoo (repo dog) ở tab mới");
  const [zooPage] = await Promise.all([context.waitForEvent("page"), click(page, page.locator('[data-rf-action="zoo"]'))]);
  zoo = zooPage;
  await zoo.waitForLoadState("domcontentloaded");
  await zoo.waitForFunction(() => document.getElementById("world3d")?.dataset.ready === "true", null, { timeout: 90000 });
  await caption(zoo, "Robot Zoo: dog Go2 mô phỏng (ROS 2 + MuJoCo), đang DISARMED");
  await zoo.waitForTimeout(4000);
  await page.bringToFront();
  await caption(page, "9. Start (có xác nhận) — workflow điều khiển robot qua RSS → Protobus → ROS 2");
  await click(page, page.locator('[data-rf-action="start"]'));
  await page.waitForTimeout(800);
  const [start] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/api/sv/robotics/runs") && r.request().method() === "POST", { timeout: 60000 }),
    click(page, page.locator('[data-rf-action="confirm-start"]')),
  ]);
  const runInfo = await start.json();
  check(start.ok() && runInfo.state === "running", "run started " + runInfo.id);
  await page.waitForTimeout(6000);
  await zoo.bringToFront();
  await caption(zoo, "Robot thực hiện đúng workflow: Arm → thấy marker → Cúi chào → Giơ chân → Nhảy → tuần tra 2 vòng");
  // watch the robot while the studio keeps tracing; switch back periodically to show the running block
  let state = "running";
  for (let i = 0; i < 40 && state === "running"; i++) {
    await zoo.waitForTimeout(i % 4 === 3 ? 0 : 5000);
    if (i % 4 === 3) {
      await page.bringToFront();
      await page.waitForTimeout(4000);
      await zoo.bringToFront();
    }
    const status = await page.request.get(`${STUDIO}/api/sv/robotics/runs/${runInfo.id}`);
    state = (await status.json()).state;
  }
  await page.bringToFront();
  await caption(page, "10. Studio: trace từng block, kết quả lệnh có request id, log của workflow");
  const final = await (await page.request.get(`${STUDIO}/api/sv/robotics/runs/${runInfo.id}`)).json();
  const started = final.events.filter((e) => e.ev === "node" && e.state === "started").map((e) => e.node);
  const ids = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) => [await node(name).getAttribute("data-id"), key])));
  const order = started.map((id) => ids[id] ?? id);
  const commands = final.events.filter((e) => e.ev === "command" && ["SUCCEEDED", "FAILED", "REJECTED", "TIMED_OUT", "CANCELLED"].includes(e.phase))
    .map((e) => ({ node: ids[e.node] ?? e.node, path: e.path, phase: e.phase, requestId: e.requestId, message: e.message }));
  result.run = { id: runInfo.id, state: final.state, order, commands, logs: final.events.filter((e) => e.ev === "log").map((e) => e.message) };
  check(final.state === "finished", "run finished by itself");
  check(JSON.stringify(order) === JSON.stringify(["hello", "arm", "battery", "see", "bow", "paw", "jump", "patrol", "out", "back", "patrol", "out", "back", "patrol", "done", "rest"]),
    "execution order equals the workflow design: " + order.join(" → "));
  check(commands.length === 9 && commands.every((c) => c.phase === "SUCCEEDED"), "all 9 robot commands SUCCEEDED (measured robot state)");
  await page.locator("[data-rf-timeline]").scrollIntoViewIfNeeded();
  await page.waitForTimeout(6000);
  await zoo.bringToFront();
  await caption(zoo, "Kết thúc: robot về DISARMED; Stop luôn sẵn trong studio");
  await zoo.waitForTimeout(5000);
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
