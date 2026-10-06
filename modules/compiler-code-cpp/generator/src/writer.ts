/**
 * CodeWriter (ADR-0022 §5–6): deterministic text with the template's style (4-space indent,
 * attached braces, lines up to 100 columns where an argument list can break) and line tracking
 * for the source map `(file, startLine, endLine) → (workflowId, nodeId, blockId)`.
 */

export const INDENT = "    ";
export const COLUMN_LIMIT = 100;

export interface SourceRange {
  startLine: number;
  endLine: number;
  nodeId: string;
  blockId: string;
  workflowId: string;
}

export class CodeWriter {
  private readonly lines: string[] = [];
  private depth = 0;
  readonly ranges: SourceRange[] = [];

  /** 1-based number of the next line written. */
  get nextLine(): number {
    return this.lines.length + 1;
  }

  line(text = ""): this {
    this.lines.push(text === "" ? "" : INDENT.repeat(this.depth) + text);
    return this;
  }

  /** Several lines already indented relative to the current depth. */
  lines_(text: string): this {
    for (const l of text.split("\n")) this.line(l);
    return this;
  }

  /** `open {` … `}` with the body one level deeper. */
  block(open: string, body: () => void, close = "}"): this {
    this.line(`${open} {`);
    this.depth++;
    body();
    this.depth--;
    this.line(close);
    return this;
  }

  /** Records the lines `body` writes as the code of IR node `nodeId`. */
  node(workflowId: string, nodeId: string, blockId: string, body: () => void): this {
    const startLine = this.nextLine;
    body();
    this.ranges.push({ startLine, endLine: this.nextLine - 1, nodeId, blockId, workflowId });
    return this;
  }

  /**
   * A call statement `callee(arg, …);` on one line when it fits, otherwise one argument per line
   * (continuation indent 4). Arguments may span several lines themselves (lambdas).
   */
  call(callee: string, args: string[], end = ";"): this {
    const flat = `${callee}(${args.join(", ")})${end}`;
    if (!flat.includes("\n") && INDENT.length * this.depth + flat.length <= COLUMN_LIMIT) return this.line(flat);
    this.line(`${callee}(`);
    this.depth++;
    args.forEach((a, i) => {
      const parts = a.split("\n");
      parts.forEach((p, j) => this.line(j === parts.length - 1 && i < args.length - 1 ? `${p},` : p));
    });
    this.depth--;
    // close on the last argument's line
    const last = this.lines.pop()!;
    this.lines.push(`${last})${end}`);
    return this;
  }

  toString(): string {
    return `${this.lines.join("\n")}\n`;
  }
}

/**
 * A lambda `[captures](rt::Ctx& c) { return expr; }`, on one line when short, otherwise with the
 * return statement on its own line (the expression itself is never broken).
 */
export function lambda(expr: string, captures = "", param = "Ctx& c", width = 70): string {
  const head = `[${captures}](${param})`;
  const flat = `${head} { return ${expr}; }`;
  if (flat.length <= width) return flat;
  return `${head} {\n${INDENT}return ${expr};\n}`;
}
