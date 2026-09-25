import type { FunctionReturnType } from "convex/server";
import type { api } from "@/convex/_generated/api";

export type DashboardSession = FunctionReturnType<typeof api.sessions.dashboard>[number];

// Funnel buckets, in the order production cares about them.
export type Bucket = "problem" | "live" | "idle" | "ended";

export const BUCKETS: { id: Bucket; label: string }[] = [
  { id: "problem", label: "Con problemas" },
  { id: "live", label: "En vivo" },
  { id: "idle", label: "Programadas" },
  { id: "ended", label: "Finalizadas" },
];

/** A running room whose console stopped sending heartbeats for this long is "no signal". */
export const STALE_MS = 15_000;

/** Formats a session duration without wrapping after 24 hours. */
export function formatElapsed(startedAt: number | undefined, endedAt: number | undefined, now: number) {
  if (startedAt === undefined) return "—";
  const elapsedSeconds = Math.max(0, Math.floor(((endedAt ?? now) - startedAt) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function isStale(s: DashboardSession, now: number) {
  const running = s.status === "live" || s.status === "reconnecting" || s.status === "paused";
  return running && s.stats !== null && now - s.stats.lastHeartbeatAt > STALE_MS;
}

export function bucketOf(s: DashboardSession, now: number): Bucket {
  if (s.status === "error" || s.status === "reconnecting" || isStale(s, now)) return "problem";
  if (s.status === "live" || s.status === "paused") return "live";
  if (s.status === "ended") return "ended";
  return "idle";
}

export function statusChip(s: DashboardSession, now: number): { label: string; tone: "live" | "warn" | "danger" | "muted" | "info" } {
  if (isStale(s, now)) return { label: "Sin señal", tone: "danger" };
  switch (s.status) {
    case "live":
      return { label: "En vivo", tone: "live" };
    case "reconnecting":
      return { label: "Reconectando", tone: "warn" };
    case "error":
      return { label: "Error", tone: "danger" };
    case "paused":
      return { label: "Pausada", tone: "info" };
    case "ended":
      return { label: "Finalizada", tone: "muted" };
    default:
      return { label: "Programada", tone: "muted" };
  }
}
