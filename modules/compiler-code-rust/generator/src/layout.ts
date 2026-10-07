/**
 * Layout of generated Rust: deterministic and readable (black-style splitting at brackets, 100 columns).
 * rustfmt's width heuristics are not reproduced: generated items carry `#[rustfmt::skip]` (ADR-0041 Notes),
 * like the C++ backend's `DisableFormat`, so `rustfmt --check` passes without ever rewriting them.
 *
 * Code is a tree of atoms and bracketed groups. A group that fits on its line stays flat; otherwise it
 * splits at its brackets: one element ⇒ the element on its own line(s); a call whose arguments fit on one
 * indented line ⇒ that line; else one element per line with a trailing comma.
 */

export const LINE_LENGTH = 100;
export const INDENT = "    ";

export type Node = { kind: "atom"; text: string } | { kind: "group"; head: string; open: string; items: Node[]; close: string; display: boolean };

export const atom = (text: string): Node => ({ kind: "atom", text });

/** `head(arg, …)` — a call (or any trailer the generator emits). */
export const call = (head: string, args: Node[]): Node => ({ kind: "group", head, open: "(", items: args, close: ")", display: false });

/** `[…]`, `(…)` or `{…}` display (always one element per line when split). */
export const display = (open: "[" | "(" | "{", items: Node[]): Node => ({ kind: "group", head: "", open, items, close: { "[": "]", "(": ")", "{": "}" }[open], display: true });

/** `text` + node, e.g. `lambda c: ` + call, `"key": ` + dict. */
export function prefix(text: string, n: Node): Node {
  return n.kind === "atom" ? atom(text + n.text) : { ...n, head: text + n.head };
}

/** `node` + text on the same line after its closing bracket (only for atoms the generator never splits). */
export function flat(n: Node): string {
  if (n.kind === "atom") return n.text;
  const inner = n.items.map(flat).join(", ");
  // A one-element tuple display needs its comma.
  const one = n.display && n.open === "(" && n.items.length === 1 ? "," : "";
  return `${n.head}${n.open}${inner}${one}${n.close}`;
}

const fits = (line: string) => line.length <= LINE_LENGTH;

/** Lines of `n` at `depth`, followed by `suffix` (",", or "" at the end of a statement). */
export function layout(n: Node, depth: number, suffix = ""): string[] {
  const ind = INDENT.repeat(depth);
  const one = `${ind}${flat(n)}${suffix}`;
  if (n.kind === "atom" || fits(one) || n.items.length === 0) return [one];
  const head = `${ind}${n.head}${n.open}`;
  const tail = `${ind}${n.close}${suffix}`;
  if (n.items.length === 1) return [head, ...layout(n.items[0]!, depth + 1, n.display && n.open === "(" ? "," : ""), tail];
  if (!n.display) {
    const body = `${INDENT.repeat(depth + 1)}${n.items.map(flat).join(", ")}`;
    if (fits(body)) return [head, body, tail];
  }
  return [head, ...n.items.flatMap((item) => layout(item, depth + 1, ",")), tail];
}

/** `from module import a, b` — when too long, parenthesized with one name per line (black's rule for imports). */
export function importFrom(module: string, names: string[], depth = 0): string[] {
  const ind = INDENT.repeat(depth);
  const one = `${ind}from ${module} import ${names.join(", ")}`;
  if (fits(one)) return [one];
  return [`${ind}from ${module} import (`, ...names.map((n) => `${ind}${INDENT}${n},`), `${ind})`];
}
