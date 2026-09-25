"use client";

import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import type { Lang } from "@/lib/langs";

const VOICE_LANG: Record<Lang, string> = { es: "es-AR", en: "en-US", pt: "pt-BR" };

/**
 * "Listen" mode: reads each new final line aloud with the browser's built-in speech
 * synthesis (on-device, free). Only lines that arrive after enabling are spoken.
 */
export function SpeakLines({ sessionId, lang }: { sessionId: Id<"sessions">; lang: Lang }) {
  const feed = useQuery(api.segments.feed, { sessionId, lang, limit: 100 });
  const lastSpoken = useRef<number | null>(null);

  useEffect(() => {
    if (!feed || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const lines = feed.lines;
    if (lastSpoken.current === null) {
      // Start from "now": don't read the backlog.
      lastSpoken.current = lines.length ? lines[lines.length - 1].seq : -1;
      return;
    }
    for (const l of lines) {
      if (l.seq <= lastSpoken.current) continue;
      lastSpoken.current = l.seq;
      const u = new SpeechSynthesisUtterance(l.text);
      u.lang = VOICE_LANG[lang];
      u.rate = 1.1; // keep up with a live talk
      window.speechSynthesis.speak(u);
    }
  }, [feed, lang]);

  useEffect(() => () => window.speechSynthesis?.cancel(), []);
  return null;
}
