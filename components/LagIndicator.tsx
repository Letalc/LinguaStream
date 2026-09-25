"use client";

import { useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import type { Lang } from "@/lib/langs";
import { Dot } from "@/components/ui/Dot";

/**
 * Delivery lag: time between Gemini producing a piece of text (console clock) and this
 * device receiving it. Measured on each update and smoothed. It does NOT include the
 * model's own delay behind the speaker (~1-2 s), which the dashboard reports.
 * Different device clocks can skew it slightly (phones sync via NTP, usually <100 ms).
 */
export function LagIndicator({ sessionId, lang, limit }: { sessionId: Id<"sessions">; lang: Lang; limit: number }) {
  // Same args as SubtitleFeed → Convex shares one subscription.
  const feed = useQuery(api.segments.feed, { sessionId, lang, limit });
  const [lag, setLag] = useState<number | null>(null);
  const at = feed?.partialAt ?? null;

  useEffect(() => {
    if (at === null) return;
    const sample = Math.min(30_000, Math.max(0, Date.now() - at));
    // Ignore stale partials (e.g. page opened during a pause).
    if (sample > 10_000) return;
    setLag((prev) => (prev === null ? sample : Math.round(prev * 0.7 + sample * 0.3)));
  }, [at]);

  if (lag === null) return null;
  const color = lag < 1000 ? "text-emerald-400" : lag < 2500 ? "text-amber-400" : "text-red-400";
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs ${color}`} title="Demora de entrega de los subtítulos a este dispositivo">
      <Dot /> lag {(lag / 1000).toFixed(1)} s
    </span>
  );
}
