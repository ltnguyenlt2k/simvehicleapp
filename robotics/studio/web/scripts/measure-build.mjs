import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
const started = performance.now();
const result = spawnSync('npm', ['run', 'build'], { stdio: 'inherit' });
if (result.status !== 0) process.exit(result.status ?? 1);
const elapsedSeconds = (performance.now() - started) / 1000;
const peakBytes = Number(readFileSync('/sys/fs/cgroup/memory.peak', 'utf8').trim());
const report = { scope: 'actual container static TypeScript/Vite build', elapsedSeconds, peakBytes,
  maxSeconds: 120, maxBytes: 2 * 1024 ** 3 };
console.log(JSON.stringify(report));
if (!(elapsedSeconds < 120 && peakBytes > 0 && peakBytes < report.maxBytes)) process.exit(2);
writeFileSync('dist/build-metrics.json', JSON.stringify(report, null, 2) + '\n');
