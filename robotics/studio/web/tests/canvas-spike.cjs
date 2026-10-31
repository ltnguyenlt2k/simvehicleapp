const { chromium, expect } = require('@playwright/test');
const fs = require('node:fs');

(async () => {
  const browser = await chromium.launch({ headless: false, args: ['--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://web:8080', { waitUntil: 'networkidle' });
    const nodes = page.locator('.react-flow__node');
    await expect(nodes).toHaveCount(200);
    await expect(page.locator('.react-flow__edge')).toHaveCount(199);
    await expect(page.locator('.result-port')).toHaveCount(78);
    const first = nodes.first();
    await first.click();
    await expect(first).toHaveClass(/selected/);
    await first.focus();
    const before = await first.boundingBox();
    await first.press('ArrowRight');
    await page.waitForTimeout(150);
    const after = await first.boundingBox();
    expect(after.x).toBeGreaterThan(before.x);

    await page.evaluate(() => {
      window.canvasFrames = [];
      window.measureCanvas = true;
      const frame = now => {
        if (!window.measureCanvas) return;
        window.canvasFrames.push(now);
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await page.mouse.move(after.x + after.width / 2, after.y + 10);
    await page.mouse.down();
    for (let index = 1; index <= 100; index++) {
      await page.mouse.move(after.x + after.width / 2 + index, after.y + 10 + index / 4);
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    const frames = await page.evaluate(() => { window.measureCanvas = false; return window.canvasFrames; });
    const elapsedMs = frames.at(-1) - frames[0];
    const fps = (frames.length - 1) * 1000 / elapsedMs;
    expect(elapsedMs).toBeGreaterThan(1500);
    expect(fps).toBeGreaterThanOrEqual(30);
    const moved = await first.boundingBox();
    expect(moved.x - after.x).toBeGreaterThan(70);
    await expect(nodes).toHaveCount(200);
    const source = page.locator('.react-flow__node[data-id="block-5"] .react-flow__handle.source[data-handleid="failed"]');
    const target = page.locator('.react-flow__node[data-id="block-8"] .react-flow__handle.target[data-handleid="in"]');
    async function connectHandles(from, to) {
      const a = await from.boundingBox(), b = await to.boundingBox();
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 20 });
      await page.mouse.up();
    }
    await connectHandles(source, target);
    await expect(page.locator('.react-flow__edge')).toHaveCount(200);
    await connectHandles(source, page.locator('.react-flow__node[data-id="block-5"] .react-flow__handle.target[data-handleid="in"]'));
    await expect(page.locator('.react-flow__edge')).toHaveCount(200);
    expect(errors).toEqual([]);
    await page.screenshot({ path: '/evidence/canvas-200.png', fullPage: true });
    const result = { passed: true, scope: 'actual headed Chromium, 200 React Flow custom nodes',
      frames: frames.length, elapsedMs, fps, keyboardMovedPx: after.x - before.x,
      pointerMovedPx: moved.x - after.x, nodes: 200, edges: 200, resultHandles: 78, validConnectionAdded: true, selfConnectionRejected: true };
    fs.writeFileSync('/evidence/canvas-200.json', JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
