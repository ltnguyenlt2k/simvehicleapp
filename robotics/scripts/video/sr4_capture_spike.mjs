// Spike S-R4 (ADR-0071): two real browser windows on one Xvfb screen, full-screen ffmpeg x11grab.
// Measures Robot Zoo camera/WebGL cadence without and with recording, and ffmpeg CPU.
// Run inside robotics/recorder with --network host and DISPLAY prepared by xvfb (see M22 report).
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";

const zoo = process.env.ZOO_URL || "http://127.0.0.1:8090";
const out = process.env.OUT || "/evidence";
const seconds = Number(process.env.SECONDS_PER_PHASE || 30);
const W = 1600, H = 900;

async function window(x, width, url) {
  const browser = await chromium.launch({
    headless: false,
    args: [`--window-position=${x},0`, `--window-size=${width},${H}`, "--no-first-run", "--disable-dev-shm-usage",
      "--use-gl=angle", "--use-angle=gl", "--ignore-gpu-blocklist", "--disable-renderer-backgrounding"],
  });
  const page = await (await browser.newContext({ viewport: null })).newPage();
  await page.goto(url);
  return { browser, page };
}

async function probe(page) {
  await page.evaluate(() => {
    window.sr4 = { frames: 0, images: 0 };
    document.getElementById("aux-camera-image").addEventListener("load", () => window.sr4.images++);
    const tick = () => { window.sr4.frames++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
}

async function measure(page) {
  const start = await page.evaluate(() => ({ ...window.sr4, t: performance.now() }));
  await new Promise((r) => setTimeout(r, seconds * 1000));
  const end = await page.evaluate(() => ({ ...window.sr4, t: performance.now() }));
  const dt = (end.t - start.t) / 1000;
  return { seconds: +dt.toFixed(2), cameraFps: +((end.images - start.images) / dt).toFixed(2),
           webglFps: +((end.frames - start.frames) / dt).toFixed(2) };
}

async function cpuSeconds(pid) {
  const stat = (await fs.readFile(`/proc/${pid}/stat`, "utf8")).split(") ")[1].split(" ");
  return (Number(stat[11]) + Number(stat[12])) / 100; // utime + stime, clock ticks of 10 ms
}

await fs.mkdir(out, { recursive: true });
const zooWin = await window(0, 960, `${zoo}/#sensors`);
const other = await window(960, 640, `${zoo}/#map`);
await zooWin.page.waitForFunction(() => document.getElementById("world3d")?.dataset.ready === "true", {}, { timeout: 60000 });
await zooWin.page.waitForFunction(() => document.getElementById("aux-camera-image")?.naturalWidth > 0, {}, { timeout: 30000 });
await probe(zooWin.page);
await new Promise((r) => setTimeout(r, 5000));
const baseline = await measure(zooWin.page);

const ffmpeg = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-framerate", "25",
  "-video_size", `${W}x${H}`, "-i", process.env.DISPLAY, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
  "-pix_fmt", "yuv420p", `${out}/sr4.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
await new Promise((r) => setTimeout(r, 3000));
const cpu0 = await cpuSeconds(ffmpeg.pid), t0 = Date.now();
const recording = await measure(zooWin.page);
const recorderCores = +(((await cpuSeconds(ffmpeg.pid)) - cpu0) / ((Date.now() - t0) / 1000)).toFixed(3);
ffmpeg.stdin.write("q");
await new Promise((r) => ffmpeg.on("exit", r));
const result = { spike: "S-R4", screen: `${W}x${H}@25`, zoo, baseline, recording, recorderCores,
  cameraDropPct: +(100 * (1 - recording.cameraFps / baseline.cameraFps)).toFixed(1) };
await fs.writeFile(`${out}/sr4.json`, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result));
await zooWin.browser.close();
await other.browser.close();
