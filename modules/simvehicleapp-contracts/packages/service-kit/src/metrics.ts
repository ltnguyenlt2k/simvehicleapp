// Infrastructure only — Prometheus text exposition for the services' `/metrics` (ADR-0033 §2).

export type Labels = Record<string, string | number>;

const DEFAULT_BUCKETS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000, 300000, 600000];

const escapeLabel = (v: string) => v.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/"/g, '\\"');
const labelText = (labels: Labels) => {
  const keys = Object.keys(labels).sort();
  return keys.length ? `{${keys.map((k) => `${k}="${escapeLabel(String(labels[k]))}"`).join(",")}}` : "";
};
const keyOf = (labels: Labels) => labelText(labels);

interface Series {
  labels: Labels;
  value: number;
}
interface HistSeries {
  labels: Labels;
  counts: number[];
  sum: number;
  count: number;
}

export interface Counter {
  inc(labels?: Labels, by?: number): void;
}
export interface Histogram {
  observe(labels: Labels, value: number): void;
}

/**
 * A small metrics registry (counters, gauges set by callbacks, histograms in ms) rendered in the
 * Prometheus text format 0.0.4. Series are kept per label set; label values must be low-cardinality
 * (stage names, diagnostic codes, status classes — never ids).
 */
export class Metrics {
  private readonly counters = new Map<string, { help: string; series: Map<string, Series> }>();
  private readonly histograms = new Map<string, { help: string; buckets: number[]; series: Map<string, HistSeries> }>();
  private readonly gauges = new Map<string, { help: string; read: () => number | Labels[] | { labels: Labels; value: number }[] }>();

  constructor(private readonly prefix = "sv_") {}

  counter(name: string, help: string): Counter {
    const full = this.prefix + name;
    const entry = this.counters.get(full) ?? { help, series: new Map<string, Series>() };
    this.counters.set(full, entry);
    return {
      inc: (labels = {}, by = 1) => {
        const k = keyOf(labels);
        const s = entry.series.get(k) ?? { labels, value: 0 };
        s.value += by;
        entry.series.set(k, s);
      },
    };
  }

  histogram(name: string, help: string, buckets = DEFAULT_BUCKETS_MS): Histogram {
    const full = this.prefix + name;
    const entry = this.histograms.get(full) ?? { help, buckets: [...buckets].sort((a, b) => a - b), series: new Map<string, HistSeries>() };
    this.histograms.set(full, entry);
    return {
      observe: (labels, value) => {
        const k = keyOf(labels);
        const s = entry.series.get(k) ?? { labels, counts: entry.buckets.map(() => 0), sum: 0, count: 0 };
        entry.buckets.forEach((b, i) => {
          if (value <= b) s.counts[i]!++;
        });
        s.sum += value;
        s.count++;
        entry.series.set(k, s);
      },
    };
  }

  /** A gauge read at scrape time (e.g. queue length, active runs). */
  gauge(name: string, help: string, read: () => number | { labels: Labels; value: number }[]): void {
    this.gauges.set(this.prefix + name, { help, read: read as never });
  }

  render(): string {
    const out: string[] = [];
    for (const [name, c] of [...this.counters].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`# HELP ${name} ${c.help}`, `# TYPE ${name} counter`);
      for (const s of c.series.values()) out.push(`${name}${labelText(s.labels)} ${s.value}`);
    }
    for (const [name, g] of [...this.gauges].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`# HELP ${name} ${g.help}`, `# TYPE ${name} gauge`);
      const v = g.read();
      if (typeof v === "number") out.push(`${name} ${v}`);
      else for (const s of v as { labels: Labels; value: number }[]) out.push(`${name}${labelText(s.labels)} ${s.value}`);
    }
    for (const [name, h] of [...this.histograms].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`# HELP ${name} ${h.help}`, `# TYPE ${name} histogram`);
      for (const s of h.series.values()) {
        h.buckets.forEach((b, i) => out.push(`${name}_bucket${labelText({ ...s.labels, le: b })} ${s.counts[i]}`));
        out.push(`${name}_bucket${labelText({ ...s.labels, le: "+Inf" })} ${s.count}`);
        out.push(`${name}_sum${labelText(s.labels)} ${s.sum}`, `${name}_count${labelText(s.labels)} ${s.count}`);
      }
    }
    return `${out.join("\n")}\n`;
  }
}
