import { describe, expect, test } from "bun:test";
import { MAX_DEPTH, MAX_SOURCE_LENGTH, parseExpression, type SvxError, toSexpr } from "./index.ts";
import type { Node } from "./ast.ts";

const sexpr = (src: string): string => {
  const r = parseExpression(src);
  if (!r.ok) throw new Error(`${src}: ${r.error.code}/${r.error.reason} ${r.error.message}`);
  return toSexpr(r.ast);
};
const error = (src: string): SvxError => {
  const r = parseExpression(src);
  if (r.ok) throw new Error(`${src}: expected an error, got ${toSexpr(r.ast)}`);
  return r.error;
};

/** [source, expected S-expression] — analysis/06 §4 grammar. */
const VALID: [string, string][] = [
  // literals
  ["0", "0"],
  ["42", "42"],
  ["3.14", "3.14"],
  ["1e3", "1e3"],
  ["2.5E-2", "2.5E-2"],
  ["9223372036854775807", "9223372036854775807"],
  ["18446744073709551615", "18446744073709551615"],
  ["true", "true"],
  ["false", "false"],
  ['"hello"', '"hello"'],
  ['""', '""'],
  ['"a \\"quoted\\" word"', '"a \\"quoted\\" word"'],
  ['"line\\nbreak\\ttab"', '"line\\nbreak\\ttab"'],
  ['"back\\\\slash"', '"back\\\\slash"'],
  ['"braces \\{ok\\}"', '"braces {ok}"'],
  ['"ünïcødé ✓"', '"ünïcødé ✓"'],
  // numbers with units
  ["120 km/h", "120km/h"],
  ["120km/h", "120km/h"],
  ["2 s", "2s"],
  ["500 ms", "500ms"],
  ["20 %", "20%"],
  ["20%", "20%"],
  ["21.5 celsius", "21.5celsius"],
  ["3 m/s", "3m/s"],
  ["250 kPa", "250kPa"],
  ["1 min", "1min"],
  ["7 kWh", "7kWh"],
  ["2 s + 500 ms", "(+ 2s 500ms)"],
  ["<Vehicle.Speed> > 120 km/h", "(> <Vehicle.Speed> 120km/h)"],
  ["<x.y> > 20 % && true", "(&& (> <x.y> 20%) true)"],
  ["20 % 3", "(% 20 3)"],
  ["20 % -3", "(% 20 (neg 3))"],
  ["20 % <x.y>", "(% 20 <x.y>)"],
  ["20%(3)", "(% 20 3)"],
  ["clamp(5 %, 0 %, 100 %)", "(clamp 5% 0% 100%)"],
  // references
  ["<Vehicle.Speed>", "<Vehicle.Speed>"],
  ["<Vehicle.Cabin.Door.Row1.DriverSide.IsLocked>", "<Vehicle.Cabin.Door.Row1.DriverSide.IsLocked>"],
  ["<readspeed1.value>", "<readspeed1.value>"],
  ["<whenspeedchanges1.previous>", "<whenspeedchanges1.previous>"],
  ["<variable.warnActive>", "<variable.warnActive>"],
  ["<loop.index>", "<loop.index>"],
  ["<parallel.currentItem>", "<parallel.currentItem>"],
  ["<api1.data.items>", "<api1.data.items>"],
  ["<_x.y>", "<_x.y>"],
  ["<a.0>", "<a.0>"],
  ["<Vehicle.OBD.PidsA>[0]", "(at <Vehicle.OBD.PidsA> 0)"],
  ["<a.b>[0][1]", "(at (at <a.b> 0) 1)"],
  ["<a.b>[<loop.index> + 1]", "(at <a.b> (+ <loop.index> 1))"],
  // arithmetic precedence
  ["1 + 2", "(+ 1 2)"],
  ["1 - 2", "(- 1 2)"],
  ["1 + 2 * 3", "(+ 1 (* 2 3))"],
  ["1 * 2 + 3", "(+ (* 1 2) 3)"],
  ["1 - 2 - 3", "(- (- 1 2) 3)"],
  ["8 / 4 / 2", "(/ (/ 8 4) 2)"],
  ["7 % 4 * 2", "(* (% 7 4) 2)"],
  ["(1 + 2) * 3", "(* (+ 1 2) 3)"],
  ["((1))", "1"],
  ["-1", "(neg 1)"],
  ["--1", "(neg (neg 1))"],
  ["-(1 + 2)", "(neg (+ 1 2))"],
  ["-<a.b> * 2", "(* (neg <a.b>) 2)"],
  ["2 * -3", "(* 2 (neg 3))"],
  ["1 - -1", "(- 1 (neg 1))"],
  ["1+2*3-4/5%6", "(- (+ 1 (* 2 3)) (% (/ 4 5) 6))"],
  // comparison
  ["1 == 1", "(== 1 1)"],
  ["1 != 2", "(!= 1 2)"],
  ["1 < 2", "(< 1 2)"],
  ["1 <= 2", "(<= 1 2)"],
  ["1 > 2", "(> 1 2)"],
  ["1 >= 2", "(>= 1 2)"],
  ["1 + 1 == 2", "(== (+ 1 1) 2)"],
  ["<a.b>< 5", "(< <a.b> 5)"],
  ["5 <<a.b>", "(< 5 <a.b>)"],
  ["5<<a.b>", "(< 5 <a.b>)"],
  ["<a.b>><c.d>", "(> <a.b> <c.d>)"],
  ["(1 < 2) == true", "(== (< 1 2) true)"],
  ["<Vehicle.Speed> < 2.5 && <a.b> > 1.5", "(&& (< <Vehicle.Speed> 2.5) (> <a.b> 1.5))"],
  ["<a.b> <2.5", "(< <a.b> 2.5)"],
  ["1 <abs(2.5)", "(< 1 (abs 2.5))"],
  ['<Vehicle.Body.Windshield.Front.Wiping.Mode> == "RAIN_SENSOR"', '(== <Vehicle.Body.Windshield.Front.Wiping.Mode> "RAIN_SENSOR")'],
  // logic
  ["true && false", "(&& true false)"],
  ["true || false", "(|| true false)"],
  ["true || false && false", "(|| true (&& false false))"],
  ["(true || false) && false", "(&& (|| true false) false)"],
  ["!true", "(! true)"],
  ["!!true", "(! (! true))"],
  ["!<a.b> == 1", "(! (== <a.b> 1))"],
  ["!(<a.b> == 1)", "(! (== <a.b> 1))"],
  ["!true && false", "(&& (! true) false)"],
  ["<a.b> > 1 && <a.c> < 2 || <a.d>", "(|| (&& (> <a.b> 1) (< <a.c> 2)) <a.d>)"],
  ["a_b_ok(1)".replace("a_b_ok", "abs"), "(abs 1)"],
  // ternary
  ["true ? 1 : 2", "(? true 1 2)"],
  ["true ? 1 : false ? 2 : 3", "(? true 1 (? false 2 3))"],
  ["true ? false ? 1 : 2 : 3", "(? true (? false 1 2) 3)"],
  ["1 < 2 ? 1 + 1 : 2 * 2", "(? (< 1 2) (+ 1 1) (* 2 2))"],
  ["(true ? 1 : 2) + 3", "(+ (? true 1 2) 3)"],
  ["true || false ? 1 : 2", "(? (|| true false) 1 2)"],
  ['<a.b> ? "on" : "off"', '(? <a.b> "on" "off")'],
  // calls
  ["abs(-5)", "(abs (neg 5))"],
  ["min(1, 2)", "(min 1 2)"],
  ["max(1, 2, 3, 4)", "(max 1 2 3 4)"],
  ["clamp(<a.b>, 0, 100)", "(clamp <a.b> 0 100)"],
  ["round(1.5)", "(round 1.5)"],
  ["round(1.55, 1)", "(round 1.55 1)"],
  ["floor(1.5)", "(floor 1.5)"],
  ["ceil(1.5)", "(ceil 1.5)"],
  ["scale(<a.b>, 0, 100, 0, 1)", "(scale <a.b> 0 100 0 1)"],
  ["in_range(<Vehicle.Speed>, 0 km/h, 130 km/h)", "(in_range <Vehicle.Speed> 0km/h 130km/h)"],
  ["now_ms()", "(now_ms)"],
  ["len(<Vehicle.OBD.PidsA>)", "(len <Vehicle.OBD.PidsA>)"],
  ['at(<Vehicle.OBD.PidsA>, 99, "N/A")', '(at <Vehicle.OBD.PidsA> 99 "N/A")'],
  ['contains(<Vehicle.OBD.PidsA>, "01")', '(contains <Vehicle.OBD.PidsA> "01")'],
  ["abs(min(1, 2))", "(abs (min 1 2))"],
  ["abs(1)[0]", "(at (abs 1) 0)"],
  ["max(abs(-1), 2) * 3", "(* (max (abs (neg 1)) 2) 3)"],
  ["len(<a.b>) > 0 && at(<a.b>, 0) == 1", "(&& (> (len <a.b>) 0) (== (at <a.b> 0) 1))"],
  ["abs( 1 )", "(abs 1)"],
  ["min(1,2)", "(min 1 2)"],
  // whitespace
  ["  1  ", "1"],
  ["\t1\n+\n2", "(+ 1 2)"],
  ["1+2", "(+ 1 2)"],
  // templates (M03-T03)
  ['"Speed {<Vehicle.Speed>} km/h"', '(tpl "Speed " <Vehicle.Speed> " km/h")'],
  ['"{<a.b>}"', "(tpl <a.b>)"],
  ['"{1 + 2}{3}"', "(tpl (+ 1 2) 3)"],
  ['"x={<a.b> > 1 ? "hi" : "lo"}"', '(tpl "x=" (? (> <a.b> 1) "hi" "lo"))'],
  ['"n={len(<a.b>)} items"', '(tpl "n=" (len <a.b>) " items")'],
  ['"nested {"{<a.b>}"} ok"', '(tpl "nested " (tpl <a.b>) " ok")'],
  ['"a {1} b {2} c"', '(tpl "a " 1 " b " 2 " c")'],
  ['"brace \\} inside {1}"', '(tpl "brace } inside " 1)'],
  ['"Speed " + "x"', '(+ "Speed " "x")'],
];

/** [source, expected code, reason]. */
const INVALID: [string, SvxError["code"], SvxError["reason"]][] = [
  ["", "EXPR_SYNTAX", "empty"],
  ["   ", "EXPR_SYNTAX", "empty"],
  ["1 +", "EXPR_SYNTAX", "unexpected_end"],
  ["(1 + 2", "EXPR_SYNTAX", "unexpected_end"],
  ["1 + 2)", "EXPR_SYNTAX", "unexpected_token"],
  [")", "EXPR_SYNTAX", "unexpected_token"],
  ["1 2", "EXPR_SYNTAX", "unexpected_token"],
  ["* 2", "EXPR_SYNTAX", "unexpected_token"],
  ["1 * * 2", "EXPR_SYNTAX", "unexpected_token"],
  ["+1", "EXPR_SYNTAX", "unexpected_token"],
  ["1 ==", "EXPR_SYNTAX", "unexpected_end"],
  ["== 1", "EXPR_SYNTAX", "unexpected_token"],
  ["1 = 2", "EXPR_SYNTAX", "unexpected_char"],
  ["1 & 2", "EXPR_SYNTAX", "unexpected_char"],
  ["1 | 2", "EXPR_SYNTAX", "unexpected_char"],
  ["1 ^ 2", "EXPR_SYNTAX", "unexpected_char"],
  ["1 ; 2", "EXPR_SYNTAX", "unexpected_char"],
  ["1 $ 2", "EXPR_SYNTAX", "unexpected_char"],
  ["#", "EXPR_SYNTAX", "unexpected_char"],
  ["'single'", "EXPR_SYNTAX", "unexpected_char"],
  ["`tick`", "EXPR_SYNTAX", "unexpected_char"],
  ["1.2.3", "EXPR_SYNTAX", "bad_number"],
  ["1.", "EXPR_SYNTAX", "bad_number"],
  [".5", "EXPR_SYNTAX", "unexpected_char"],
  ["1 < 2 < 3", "EXPR_SYNTAX", "chained_comparison"],
  ["1 < 2 == true", "EXPR_SYNTAX", "chained_comparison"],
  ["1 == 2 == 3", "EXPR_SYNTAX", "chained_comparison"],
  ["1 < 2 >= 3", "EXPR_SYNTAX", "chained_comparison"],
  ["<a.b> != 1 != 2", "EXPR_SYNTAX", "chained_comparison"],
  ["true ?", "EXPR_SYNTAX", "unexpected_end"],
  ["true ? 1", "EXPR_SYNTAX", "unexpected_end"],
  ["true ? 1 2", "EXPR_SYNTAX", "unexpected_token"],
  ["? 1 : 2", "EXPR_SYNTAX", "unexpected_token"],
  ["true : 1", "EXPR_SYNTAX", "unexpected_token"],
  ["speed", "EXPR_SYNTAX", "unknown_identifier"],
  ["Vehicle.Speed", "EXPR_SYNTAX", "unknown_identifier"],
  ["x > 1", "EXPR_SYNTAX", "unknown_identifier"],
  ["null", "EXPR_SYNTAX", "unknown_identifier"],
  ["True", "EXPR_SYNTAX", "unknown_identifier"],
  ["abs", "EXPR_SYNTAX", "unknown_identifier"],
  ["foo(1)", "EXPR_UNKNOWN_FUNCTION", "unknown_function"],
  ["eval(1)", "EXPR_UNKNOWN_FUNCTION", "unknown_function"],
  ["Math(1)", "EXPR_UNKNOWN_FUNCTION", "unknown_function"],
  ["constructor(1)", "EXPR_UNKNOWN_FUNCTION", "unknown_function"],
  ["__proto__(1)", "EXPR_UNKNOWN_FUNCTION", "unknown_function"],
  ["toString(1)", "EXPR_UNKNOWN_FUNCTION", "unknown_function"],
  ["abs()", "EXPR_SYNTAX", "wrong_arity"],
  ["abs(1, 2)", "EXPR_SYNTAX", "wrong_arity"],
  ["min(1)", "EXPR_SYNTAX", "wrong_arity"],
  ["clamp(1, 2)", "EXPR_SYNTAX", "wrong_arity"],
  ["scale(1, 2, 3, 4)", "EXPR_SYNTAX", "wrong_arity"],
  ["now_ms(1)", "EXPR_SYNTAX", "wrong_arity"],
  ["at(<a.b>)", "EXPR_SYNTAX", "wrong_arity"],
  ["at(<a.b>, 1, 2, 3)", "EXPR_SYNTAX", "wrong_arity"],
  ["abs(1,)", "EXPR_SYNTAX", "unexpected_token"],
  ["abs(,1)", "EXPR_SYNTAX", "unexpected_token"],
  ["abs(1", "EXPR_SYNTAX", "unexpected_end"],
  ["abs 1", "EXPR_SYNTAX", "unknown_identifier"],
  ["<Vehicle>", "EXPR_SYNTAX", "bad_ref"],
  ["<a>", "EXPR_SYNTAX", "bad_ref"],
  ["<a.b", "EXPR_SYNTAX", "bad_ref"],
  ["<a b.c>", "EXPR_SYNTAX", "bad_ref"],
  ["<1a.b>", "EXPR_SYNTAX", "unexpected_char"],
  ["<a..b>", "EXPR_SYNTAX", "bad_ref"],
  ["<a.b-c>", "EXPR_SYNTAX", "bad_ref"],
  ["x <variable.y + 1", "EXPR_SYNTAX", "bad_ref"],
  ["< a.b >", "EXPR_SYNTAX", "unknown_identifier"],
  ["<>", "EXPR_SYNTAX", "unexpected_token"],
  ["<a.b>[", "EXPR_SYNTAX", "unexpected_end"],
  ["<a.b>[1", "EXPR_SYNTAX", "unexpected_end"],
  ["<a.b>[]", "EXPR_SYNTAX", "unexpected_token"],
  ['"open', "EXPR_SYNTAX", "unterminated_string"],
  ['"bad \\q escape"', "EXPR_SYNTAX", "bad_escape"],
  ['"tail \\', "EXPR_SYNTAX", "bad_escape"],
  ['"{"', "EXPR_SYNTAX", "unbalanced_brace"],
  ['"{\\', "EXPR_SYNTAX", "unbalanced_brace"],
  ['"a } b"', "EXPR_SYNTAX", "unbalanced_brace"],
  ['"{}"', "EXPR_SYNTAX", "unexpected_end"],
  ['"{ 1 + }"', "EXPR_SYNTAX", "unexpected_end"],
  ['"{foo(1)}"', "EXPR_UNKNOWN_FUNCTION", "unknown_function"],
  ["()", "EXPR_SYNTAX", "unexpected_token"],
  ["!", "EXPR_SYNTAX", "unexpected_end"],
  ["-", "EXPR_SYNTAX", "unexpected_end"],
];

describe("SVX parser: valid expressions", () => {
  test.each(VALID)("%s", (src, want) => {
    expect(sexpr(src)).toBe(want);
  });
});

describe("SVX parser: errors carry code, reason and a span inside the source", () => {
  test.each(INVALID)("%s → %s/%s", (src, code, reason) => {
    const e = error(src);
    expect([e.code, e.reason]).toEqual([code, reason]);
    expect(e.span.start).toBeGreaterThanOrEqual(0);
    expect(e.span.end).toBeLessThanOrEqual(Math.max(src.length, 1));
    expect(e.span.start).toBeLessThanOrEqual(e.span.end);
    expect(e.message.length).toBeGreaterThan(0);
  });
});

test("the case tables cover at least 200 expressions (M02-T01 phase test)", () => {
  expect(VALID.length + INVALID.length).toBeGreaterThanOrEqual(200);
});

describe("spans", () => {
  test("nodes point at their source text", () => {
    const src = "abs(<Vehicle.Speed> - 120 km/h) > 5";
    const r = parseExpression(src);
    if (!r.ok) throw new Error(r.error.message);
    const cmp = r.ast;
    expect(cmp.type).toBe("binary");
    if (cmp.type !== "binary" || cmp.left.type !== "call") throw new Error("shape");
    const call = cmp.left;
    expect(src.slice(call.span.start, call.span.end)).toBe("abs(<Vehicle.Speed> - 120 km/h)");
    const inner = call.args[0]!;
    if (inner.type !== "binary") throw new Error("shape");
    expect(src.slice(inner.left.span.start, inner.left.span.end)).toBe("<Vehicle.Speed>");
    expect(src.slice(inner.right.span.start, inner.right.span.end)).toBe("120 km/h");
    expect(cmp.span).toEqual({ start: 0, end: src.length });
  });

  test("template parts have absolute spans", () => {
    const src = 'x + "A {<a.b>} B"'.slice(4);
    const r = parseExpression(src);
    if (!r.ok || r.ast.type !== "template") throw new Error("shape");
    const ref = r.ast.parts[1] as Node;
    expect(src.slice(ref.span.start, ref.span.end)).toBe("<a.b>");
  });

  test("error spans point at the offending token", () => {
    const src = "1 + foo(2)";
    const e = error(src);
    expect(src.slice(e.span.start, e.span.end)).toBe("foo");
    const e2 = error("<a.b> > 1 < 2");
    expect(e2.span).toEqual({ start: 10, end: 11 });
  });
});

describe("limits (ADR-0013 §6)", () => {
  test("length", () => {
    const ok = `1${" + 1".repeat((MAX_SOURCE_LENGTH - 1) / 4 - 1)}`;
    expect(ok.length).toBeLessThanOrEqual(MAX_SOURCE_LENGTH);
    expect(parseExpression(ok).ok).toBe(true);
    const e = error(`${"1".padEnd(MAX_SOURCE_LENGTH + 1, " ")}`);
    expect(e.reason).toBe("too_long");
  });

  test("depth", () => {
    expect(parseExpression(`${"(".repeat(MAX_DEPTH - 2)}1${")".repeat(MAX_DEPTH - 2)}`).ok).toBe(true);
    expect(error(`${"(".repeat(MAX_DEPTH + 1)}1${")".repeat(MAX_DEPTH + 1)}`).reason).toBe("too_deep");
    expect(error(`${"-".repeat(MAX_DEPTH + 5)}1`).reason).toBe("too_deep");
    expect(error(`${"abs(".repeat(MAX_DEPTH + 1)}1${")".repeat(MAX_DEPTH + 1)}`).reason).toBe("too_deep");
    expect(error(`"${"{".repeat(40)}1${"}".repeat(40)}"`).code).toBe("EXPR_SYNTAX")
  });

  test("long flat chains stay linear (no recursion per operator)", () => {
    const chain = Array(250).fill("<a.b>").join(" + ");
    expect(chain.length).toBeLessThanOrEqual(MAX_SOURCE_LENGTH);
    expect(parseExpression(chain).ok).toBe(true);
  });
});

describe("references", () => {
  test("kinds follow the first segment (case-sensitive Vehicle, Sim prefixes)", () => {
    const kinds = ["<Vehicle.Speed>", "<vehicle.speed>", "<variable.x>", "<loop.index>", "<parallel.item>", "<readspeed1.value>"].map((s) => {
      const r = parseExpression(s);
      if (!r.ok || r.ast.type !== "ref") throw new Error(s);
      return r.ast.kind;
    });
    expect(kinds).toEqual(["vehicle", "block", "variable", "loop", "parallel", "block"]);
  });
});

/** Deterministic PRNG so failures reproduce (mulberry32). */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Random AST rendered fully parenthesised; parsing it back must give the same S-expression. */
function randomExpr(r: () => number, depth: number): { src: string; sexpr: string } {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
  if (depth <= 0 || r() < 0.3) {
    const leaf = pick(["num", "unit", "ref", "bool", "str"] as const);
    if (leaf === "num") {
      const n = String(Math.floor(r() * 1000));
      return { src: n, sexpr: n };
    }
    if (leaf === "unit") {
      const u = pick(["km/h", "s", "ms", "%", "celsius"]);
      const n = String(Math.floor(r() * 100));
      return { src: `${n} ${u}`, sexpr: `${n}${u}` };
    }
    if (leaf === "ref") {
      const p = pick(["Vehicle.Speed", "readspeed1.value", "variable.x", "loop.index"]);
      return { src: `<${p}>`, sexpr: `<${p}>` };
    }
    if (leaf === "bool") {
      const b = pick(["true", "false"]);
      return { src: b, sexpr: b };
    }
    const s = pick(["a", "", "x y"]);
    return { src: JSON.stringify(s), sexpr: JSON.stringify(s) };
  }
  const kind = pick(["bin", "un", "tern", "call", "idx"] as const);
  const a = randomExpr(r, depth - 1);
  const b = randomExpr(r, depth - 1);
  if (kind === "bin") {
    const op = pick(["+", "-", "*", "/", "%", "==", "!=", "<", "<=", ">", ">=", "&&", "||"]);
    return { src: `(${a.src}) ${op} (${b.src})`, sexpr: `(${op} ${a.sexpr} ${b.sexpr})` };
  }
  if (kind === "un") {
    const op = pick(["-", "!"]);
    return { src: `${op}(${a.src})`, sexpr: `(${op === "-" ? "neg" : "!"} ${a.sexpr})` };
  }
  if (kind === "tern") {
    const c = randomExpr(r, depth - 1);
    return { src: `(${c.src}) ? (${a.src}) : (${b.src})`, sexpr: `(? ${c.sexpr} ${a.sexpr} ${b.sexpr})` };
  }
  if (kind === "call") return { src: `min(${a.src}, ${b.src})`, sexpr: `(min ${a.sexpr} ${b.sexpr})` };
  return { src: `(${a.src})[${b.src}]`, sexpr: `(at ${a.sexpr} ${b.sexpr})` };
}

test("round trip: 2 000 random ASTs parse back to the same tree", () => {
  const r = rng(20261004);
  for (let i = 0; i < 2000; i++) {
    const { src, sexpr: want } = randomExpr(r, 5);
    if (src.length > MAX_SOURCE_LENGTH) continue;
    expect(sexpr(src)).toBe(want);
  }
});
