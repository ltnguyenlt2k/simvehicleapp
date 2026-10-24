import type { Field } from "./broker.ts";

/** Where a signal value came from (contracts `signal-update` 1.1, ADR-0062 §3). */
export type Source = "inject" | "playback" | "mirror" | "app" | "vehicle";

/** A change the gateway made itself is recognised within this window of its own write (the databroker echoes it). */
export const SOURCE_WINDOW_MS = 250;
const MAX_MARKS = 1000;

type Mark = { at: number; source: Source };

/**
 * The gateway's own writes, per databroker (release or sandbox), so a change it sees on a subscription can say who
 * made it: the user's inject, a test playback or the target→current mirror. Changes it did not make are the app's
 * (an actuator's target, or a current value the gateway publishes as the provider of a v2 app) or the vehicle's.
 */
export class Sources {
  private marks = new Map<string, Mark>();

  constructor(private now: () => number = Date.now) {}

  private static id(key: string, path: string, field: Field, value: unknown) {
    return `${key}\u0000${path}\u0000${field}\u0000${JSON.stringify(value)}`;
  }

  mark(key: string, path: string, field: Field, value: unknown, source: Source) {
    const id = Sources.id(key, path, field, value);
    this.marks.delete(id);
    this.marks.set(id, { at: this.now(), source });
    if (this.marks.size > MAX_MARKS) this.marks.delete(this.marks.keys().next().value as string);
  }

  /** The gateway's own write of this value within the window, if any. */
  own(key: string, path: string, field: Field, value: unknown): Mark | undefined {
    const m = this.marks.get(Sources.id(key, path, field, value));
    return m && Math.abs(this.now() - m.at) <= SOURCE_WINDOW_MS ? m : undefined;
  }
}

/**
 * Source of a change seen on a subscription. `provided`: the gateway is the provider of this actuator for a v2 app,
 * so its current value is the app's actuation. `deployed`: a deployment's databroker, where every value is the vehicle's.
 */
export function sourceOf(
  sources: Sources,
  key: string,
  u: { path: string; field: Field; value: unknown },
  opts: { deployed: boolean; provided: boolean },
): Source {
  if (opts.deployed) return u.field === "target" ? "app" : "vehicle";
  const own = sources.own(key, u.path, u.field, u.value);
  if (own) return own.source;
  return u.field === "target" || opts.provided ? "app" : "vehicle";
}
