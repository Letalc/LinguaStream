"use client";

import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import type { Lang } from "@/lib/langs";

/** Scrolling list of final lines + the in-progress line, updated live by Convex. */
export function SubtitleFeed({
  sessionId,
  lang,
  className = "",
  limit = 50,
}: {
  sessionId: Id<"sessions">;
  lang: Lang;
  className?: string;
  limit?: number;
}) {
  const feed = useQuery(api.segments.feed, { sessionId, lang, limit });
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [feed]);

  return (
    <div className={`overflow-y-auto leading-relaxed ${className}`} aria-live="polite">
      {feed === undefined && <p className="text-neutral-500">Conectando…</p>}
      {feed && feed.lines.length === 0 && !feed.partial && (
        <p className="text-neutral-500">Esperando que empiece la charla…</p>
      )}
      {feed?.lines.map((l) => (
        <p key={l.seq} className="mb-2">{l.text}</p>
      ))}
      {feed?.partial && (
        <p className="mb-2">
          {feed.partial}
          <span className="ml-0.5 inline-block w-[0.5ch] animate-pulse opacity-70">▍</span>
        </p>
      )}
      <div ref={bottom} />
    </div>
  );
}
