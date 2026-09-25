"use client";

import { useQuery } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import type { Lang } from "@/lib/langs";

const VOICE_LANG: Record<Lang, string> = { es: "es-AR", en: "en-US", pt: "pt-BR" };
const RATE_NORMAL = 1.1;
const RATE_CATCH_UP = 1.35;

/**
 * "Listen" mode: reads each new final line aloud with the browser's on-device speech
 * synthesis. Live-first policy: it always speaks the present, never a growing backlog.
 *
 * Mount it with `key={lang}`: every language has its own line numbering, so switching
 * language must restart from "now" (reusing the old position used to read the whole
 * history or stay silent).
 */
export function SpeakLines({ sessionId, lang }: { sessionId: Id<"sessions">; lang: Lang }) {
  const feed = useQuery(api.segments.feed, { sessionId, lang, limit: 20 });
  const lastSeq = useRef<number | null>(null);
  const pending = useRef(0); // utterances queued or speaking (our own count)
  // Bumped on every cancel(): events of cancelled utterances must not touch the new count.
  const generation = useRef(0);
  const voice = useRef<SpeechSynthesisVoice | null>(null);

  // Start clean and pick a voice for this language.
  useEffect(() => {
    if (!supported()) return;
    const synth = window.speechSynthesis;
    synth.cancel();
    const pick = () => {
      const voices = synth.getVoices();
      voice.current =
        voices.find((v) => v.lang === VOICE_LANG[lang]) ??
        voices.find((v) => v.lang.toLowerCase().startsWith(lang)) ??
        null;
    };
    pick();
    synth.addEventListener("voiceschanged", pick);
    // Don't queue stale audio while the page is hidden.
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        synth.cancel();
        generation.current++;
        pending.current = 0;
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      synth.removeEventListener("voiceschanged", pick);
      document.removeEventListener("visibilitychange", onVisibility);
      synth.cancel();
      generation.current++;
      pending.current = 0;
    };
  }, [lang]);

  useEffect(() => {
    if (!feed || !supported()) return;
    const lines = feed.lines;
    const newest = lines.length ? lines[lines.length - 1].seq : -1;
    if (lastSeq.current === null) {
      lastSeq.current = newest; // start from "now", not the backlog
      return;
    }
    const fresh = lines.filter((l) => l.seq > (lastSeq.current as number));
    if (fresh.length === 0) return;
    lastSeq.current = newest;

    const synth = window.speechSynthesis;
    // Falling behind (more than one line waiting)? Drop the queue, speak only the latest.
    const behind = pending.current + fresh.length > 1;
    const toSpeak = behind ? [fresh[fresh.length - 1]] : fresh;
    if (behind && pending.current > 0) {
      synth.cancel();
      generation.current++;
      pending.current = 0;
    }
    const gen = generation.current;
    for (const l of toSpeak) {
      const u = new SpeechSynthesisUtterance(l.text);
      u.lang = VOICE_LANG[lang];
      if (voice.current) u.voice = voice.current;
      u.rate = behind ? RATE_CATCH_UP : RATE_NORMAL;
      u.onend = u.onerror = () => {
        if (gen === generation.current) pending.current = Math.max(0, pending.current - 1);
      };
      pending.current++;
      synth.speak(u);
    }
  }, [feed, lang]);

  return null;
}

function supported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}
