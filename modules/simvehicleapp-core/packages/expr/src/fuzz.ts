/**
 * SVX parser fuzzer (M03 DoD: "parser pass fuzz 10 phút không crash").
 *
 *   bun packages/expr/src/fuzz.ts [seconds=600] [seed]
 *
 * Feeds random token soups and mutations of valid expressions to `parseExpression` and checks:
 * never throws, error spans stay inside the source, each input finishes in < 50 ms, and the same
 * input always gives the same result (determinism). Exits 1 on the first violation, printing the input.
 */
import { parseExpression } from "./parser.ts";
import { toSexpr } from "./print.ts";

const seconds = Number(process.argv[2] ?? 600);
let seed = Number(process.argv[3] ?? 20261004) | 0;

function rand(): number {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

const PIECES = [
  "<Vehicle.Speed>", "<readspeed1.value>", "<variable.x>", "<loop.index>", "<a.b>", "<", ">", "<=", ">=", "==", "!=",
  "&&", "||", "!", "?", ":", "+", "-", "*", "/", "%", "(", ")", "[", "]", ",", "{", "}", '"', "\\", ".", " ", "  ",
  "1", "0", "42", "3.5", "1e3", "9223372036854775807", "km/h", "ms", "s", "%", "true", "false", "abs(", "min(",
  "clamp(", "len(", "at(", "contains(", "now_ms()", "foo(", "constructor(", "Vehicle", "x", "_", "é", "\n", "\t", "\u0000",
];
const SEEDS = [
  "<Vehicle.Speed> > 120 km/h && !<variable.warn>",
  '"Speed {<Vehicle.Speed>} km/h"',
  "clamp(<a.b> * 2, 0 %, 100 %)",
  "true ? 1 : false ? 2 : 3",
  "<Vehicle.OBD.PidsA>[<loop.index> + 1]",
  'at(<Vehicle.OBD.PidsA>, 99, "N/A")',
];

function soup(): string {
  let s = "";
  const n = 1 + Math.floor(rand() * 40);
  for (let i = 0; i < n; i++) s += pick(PIECES);
  return s;
}

function mutate(): string {
  let s = pick(SEEDS);
  const n = 1 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i++) {
    const at = Math.floor(rand() * (s.length + 1));
    const op = rand();
    if (op < 0.4) s = s.slice(0, at) + pick(PIECES) + s.slice(at);
    else if (op < 0.7) s = s.slice(0, at) + s.slice(at + 1 + Math.floor(rand() * 3));
    else s = s.slice(0, at) + s.slice(at).split("").reverse().join("").slice(0, 5) + s.slice(at + 5);
  }
  return s;
}

function deep(): string {
  const d = Math.floor(rand() * 200);
  return pick([
    () => `${"(".repeat(d)}1${")".repeat(d)}`,
    () => `${"-".repeat(d)}1`,
    () => `${"!".repeat(d)}true`,
    () => `"${"{".repeat(d)}1${"}".repeat(d)}"`,
    () => Array(d).fill("1").join(" + "),
    () => `${"true ? ".repeat(d)}1${" : 2".repeat(d)}`,
  ])();
}

function check(src: string): void {
  const t0 = performance.now();
  let r: ReturnType<typeof parseExpression>;
  try {
    r = parseExpression(src);
  } catch (e) {
    fail(src, `threw ${(e as Error).stack}`);
  }
  const ms = performance.now() - t0;
  if (ms > 50) fail(src, `took ${ms.toFixed(1)} ms`);
  const again = parseExpression(src);
  const a = r.ok ? toSexpr(r.ast) : JSON.stringify(r.error);
  const b = again.ok ? toSexpr(again.ast) : JSON.stringify(again.error);
  if (a !== b) fail(src, "non-deterministic result");
  if (!r.ok) {
    const { start, end } = r.error.span;
    if (start < 0 || end > Math.max(src.length, 1) || start > end) fail(src, `span out of range ${JSON.stringify(r.error.span)}`);
    if (!r.error.message) fail(src, "empty message");
  }
}

function fail(src: string, why: string): never {
  console.error(`fuzz: FAIL (${why})\ninput: ${JSON.stringify(src)}`);
  process.exit(1);
}

const until = Date.now() + seconds * 1000;
let n = 0;
let ok = 0;
while (Date.now() < until) {
  for (let i = 0; i < 500; i++) {
    const src = rand() < 0.45 ? soup() : rand() < 0.9 ? mutate() : deep();
    check(src);
    if (parseExpression(src).ok) ok++;
    n++;
  }
}
console.log(`fuzz: PASS — ${n} inputs in ${seconds}s (${ok} parsed, ${n - ok} rejected with a diagnostic), seed ${process.argv[3] ?? 20261004}`);
