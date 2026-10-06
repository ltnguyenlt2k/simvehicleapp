import type { Field } from "./broker.ts";

/**
 * Scenario player on the real databroker (M08-T07): `initial` at once, then each input at its time
 * (analysis/08 §4). Signal inputs set the current value (the feeder role), topic inputs are published
 * like the runtime's MockPubSub does (strings as-is, other values as JSON). One playback at a time.
 */

export interface ScenarioInput {
  t: number;
  path?: string;
  topic?: string;
  value: unknown;
}

export interface Scenario {
  name: string;
  until: number;
  initial?: Record<string, unknown>;
  inputs: ScenarioInput[];
}

export interface Playback {
  id: string;
  release: string;
  name: string;
  state: "playing" | "done" | "stopped" | "failed";
  until: number;
  played: number;
  total: number;
  startedAt: number;
  error?: string;
}

export interface PlayerIo {
  set(release: string, path: string, field: Field, value: unknown): Promise<void>;
  publish(topic: string, payload: string): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

export class Player {
  private current: Playback | null = null;
  private token = 0;

  constructor(private readonly io: PlayerIo) {}

  get playback(): Playback | null {
    return this.current;
  }

  stop() {
    this.token++;
    if (this.current?.state === "playing") this.current = { ...this.current, state: "stopped" };
  }

  /** Starts a playback (replacing any other); resolves when it ends. */
  play(id: string, release: string, scenario: Scenario): { playback: Playback; finished: Promise<Playback> } {
    this.stop();
    const token = ++this.token;
    const initial = Object.entries(scenario.initial ?? {});
    const inputs = [...scenario.inputs].map((input, i) => ({ input, i })).sort((a, b) => a.input.t - b.input.t || a.i - b.i);
    const started = this.io.now();
    this.current = { id, release, name: scenario.name, state: "playing", until: scenario.until, played: 0, total: initial.length + inputs.length, startedAt: started };
    const live = () => token === this.token;
    const step = (patch: Partial<Playback>) => {
      if (live() && this.current) this.current = { ...this.current, ...patch };
    };
    const finished = (async (): Promise<Playback> => {
      try {
        let played = 0;
        for (const [path, value] of initial) {
          if (!live()) return this.current!;
          await this.io.set(release, path, "value", value);
          step({ played: ++played });
        }
        for (const { input } of inputs) {
          const wait = started + input.t - this.io.now();
          if (wait > 0) await this.io.sleep(wait);
          if (!live()) return this.current!;
          if (input.path) await this.io.set(release, input.path, "value", input.value);
          else if (input.topic) await this.io.publish(input.topic, typeof input.value === "string" ? input.value : JSON.stringify(input.value));
          step({ played: ++played });
        }
        step({ state: "done" });
      } catch (err) {
        step({ state: "failed", error: (err as Error).message });
      }
      return this.current!;
    })();
    return { playback: this.current, finished };
  }
}
