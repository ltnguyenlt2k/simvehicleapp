import { INDENT, layout, type Node } from "./layout.ts";

/**
 * CodeWriter (ADR-0041): deterministic Rust text (layout.ts) and line
 * tracking for the source map `(file, startLine, endLine) → (workflowId, nodeId, blockId)`.
 */

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

  /** `head:` with the body one level deeper. */
  block(head: string, body: () => void): this {
    this.line(`${head}:`);
    this.depth++;
    body();
    this.depth--;
    return this;
  }

  /** Several lines already laid out (indented relative to the current depth). */
  lines_(text: string): this {
    for (const l of text.split("\n")) this.line(l);
    return this;
  }

  /** The lines `body` writes, one level deeper. */
  indent(body: () => void): this {
    this.depth++;
    body();
    this.depth--;
    return this;
  }

  /** Records the lines `body` writes as the code of IR node `nodeId`. */
  node(workflowId: string, nodeId: string, blockId: string, body: () => void): this {
    const startLine = this.nextLine;
    body();
    this.ranges.push({ startLine, endLine: this.nextLine - 1, nodeId, blockId, workflowId });
    return this;
  }

  /** A statement made of one code tree (a call, an assignment of a call or of a display). */
  stmt(n: Node): this {
    for (const l of layout(n, this.depth)) this.lines.push(l);
    return this;
  }

  /** Removes line `n` (1-based) written earlier; later source ranges move up. */
  drop(n: number): this {
    this.lines.splice(n - 1, 1);
    for (const r of this.ranges) {
      if (r.startLine > n) r.startLine--;
      if (r.endLine >= n) r.endLine--;
    }
    return this;
  }

  toString(): string {
    return `${this.lines.join("\n")}\n`;
  }
}
