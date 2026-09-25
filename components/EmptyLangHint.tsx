"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { langLabel, type Lang } from "@/lib/langs";

/**
 * A translation stays empty when the speaker already talks in that language (e.g. a Spanish
 * speaker in a session set to English → Spanish): Gemini has nothing to translate. Instead of a
 * silent screen, offer the original, which does have text.
 */
export function EmptyLangHint({
  session,
  sessionId,
  lang,
  onSwitch,
  className = "",
}: {
  session: Doc<"sessions">;
  sessionId: Id<"sessions">;
  lang: Lang;
  onSwitch: (lang: Lang) => void;
  className?: string;
}) {
  const isSource = lang === session.sourceLang;
  const running = session.status === "live" || session.status === "reconnecting" || session.status === "paused";
  const mine = useQuery(api.segments.feed, isSource || !running ? "skip" : { sessionId, lang, limit: 100 });
  const source = useQuery(api.segments.feed, isSource || !running ? "skip" : { sessionId, lang: session.sourceLang, limit: 3 });
  if (!mine || !source) return null;
  const empty = mine.lines.length === 0 && !mine.partial;
  if (!empty || source.lines.length < 2) return null;

  return (
    <div className={`rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200 ${className}`}>
      Todavía no llegó texto en {langLabel(lang)}. Si el orador ya habla en ese idioma, la traducción queda vacía.
      <button onClick={() => onSwitch(session.sourceLang)} className="mt-2 block font-semibold text-amber-100 underline">
        Ver el texto original ({langLabel(session.sourceLang)})
      </button>
    </div>
  );
}
