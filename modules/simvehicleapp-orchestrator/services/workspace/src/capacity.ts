import { statfsSync } from "node:fs";

/**
 * Free space of the projects volume and the threshold level it reached (ADR-0053 §4, disk watermarks): below `low`
 * the studio warns, below `high` no new app (or repair) is created, below `flood` no SynCode runs — reading, running,
 * cleaning and deleting stay possible so users can free space themselves.
 */
export interface Thresholds {
  lowBytes: number;
  highBytes: number;
  floodBytes: number;
}

export type CapacityLevel = "ok" | "low" | "high" | "flood";

export interface Capacity {
  freeBytes: number;
  totalBytes: number;
  level: CapacityLevel;
  thresholds: Thresholds;
}

const GB = 1024 ** 3;

/** `SV_DISK_LOW_GB` (10), `SV_DISK_HIGH_GB` (5), `SV_DISK_FLOOD_GB` (2); kept ordered flood ≤ high ≤ low. */
export function thresholdsFromEnv(env: Record<string, string | undefined> = process.env): Thresholds {
  const gb = (name: string, fallback: number) => {
    const v = Number(env[name]);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  const flood = gb("SV_DISK_FLOOD_GB", 2);
  const high = Math.max(flood, gb("SV_DISK_HIGH_GB", 5));
  const low = Math.max(high, gb("SV_DISK_LOW_GB", 10));
  return { lowBytes: Math.round(low * GB), highBytes: Math.round(high * GB), floodBytes: Math.round(flood * GB) };
}

export function levelOf(freeBytes: number, t: Thresholds): CapacityLevel {
  if (freeBytes < t.floodBytes) return "flood";
  if (freeBytes < t.highBytes) return "high";
  if (freeBytes < t.lowBytes) return "low";
  return "ok";
}

/** Capacity of the filesystem holding `root` (space available to unprivileged users, like `df`). */
export function measureCapacity(root: string, t: Thresholds, statfs: (p: string) => { bsize: number; bavail: number; blocks: number } = statfsSync): Capacity {
  const s = statfs(root);
  const freeBytes = Number(s.bavail) * Number(s.bsize);
  const totalBytes = Number(s.blocks) * Number(s.bsize);
  return { freeBytes, totalBytes, level: levelOf(freeBytes, t), thresholds: t };
}
