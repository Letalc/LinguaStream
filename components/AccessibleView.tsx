"use client";

import { useQuery } from "convex/react";
import {
  AArrowDown,
  AArrowUp,
  AudioLines,
  Contrast,
  Hand,
  Languages,
  Pause,
  Play,
  Square,
  Vibrate,
  WifiOff,
} from "@/components/ui/NeonIcon";
import { useEffect, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Doc, Id } from "@/convex/_generated/dataModel";
import { toEmbedUrl } from "@/lib/embed";
import { langLabel, type Lang } from "@/lib/langs";
import { useStoredState } from "@/lib/useStoredState";

/**
 * Reading view for deaf and hard-of-hearing people:
 *  - very large, high-contrast, highly legible text (Atkinson Hyperlegible), focus on the
 *    last 3 lines, with "pause to re-read";
 *  - a visual "someone is speaking / silence" indicator, so a quiet screen is never ambiguous;
 *  - the live video of a human sign-language interpreter, when the event provides one;
 *  - vibration when the talk starts, pauses or ends (Android; iOS web can't vibrate).
 */

const THEMES = [
  { id: "yellow", label: "Amarillo sobre negro", cls: "bg-black text-yellow-300", muted: "text-yellow-300/60", line: "border-yellow-300/30" },
  { id: "white", label: "Blanco sobre negro", cls: "bg-black text-white", muted: "text-white/60", line: "border-white/25" },
  { id: "light", label: "Negro sobre blanco", cls: "bg-white text-black", muted: "text-black/60", line: "border-black/25" },
] as const;
const SIZES = ["text-2xl", "text-3xl", "text-4xl", "text-5xl", "text-6xl"];
const FOCUS_LINES = 3;
const SPEAKING_WINDOW_MS = 1500;

type Prefs = { theme: number; size: number; vibrate: boolean; showInterpreter: boolean };
const DEFAULT_PREFS: Prefs = { theme: 0, size: 2, vibrate: true, showInterpreter: true };

function decodePreferences(raw: string): Prefs {
  const p = JSON.parse(raw);
  return {
    theme: Number.isInteger(p?.theme) ? Math.max(0, Math.min(THEMES.length - 1, p.theme)) : 0,
    size: Number.isInteger(p?.size) ? Math.max(0, Math.min(SIZES.length - 1, p.size)) : 2,
    vibrate: typeof p?.vibrate === "boolean" ? p.vibrate : true,
    showInterpreter: typeof p?.showInterpreter === "boolean" ? p.showInterpreter : true,
  };
}

export function AccessibleView({
  session,
  sessionId,
  lang,
  onChange,
}: {
  session: Doc<"sessions">;
  sessionId: Id<"sessions">;
  lang: Lang;
  onChange: () => void;
}) {
  const feed = useQuery(api.segments.feed, { sessionId, lang, limit: 100 });
  const [prefs, setPrefs] = useStoredState("live-subs-a11y", DEFAULT_PREFS, decodePreferences);
  const [paused, setPaused] = useState(false);
  const theme = THEMES[prefs.theme];
  const embed = session.interpreterUrl ? toEmbedUrl(session.interpreterUrl) : null;

  const update = (p: Partial<Prefs>) => setPrefs((prev) => ({ ...prev, ...p }));

  // --- Speaking indicator: in-progress text changing ⇒ someone is talking. Local clock only.
  const [lastChangeAt, setLastChangeAt] = useState(0);
  const prevPartial = useRef<string | null>(null);
  useEffect(() => {
    if (!feed) return;
    const key = `${feed.partial}|${feed.lines.at(-1)?.seq ?? -1}`;
    if (prevPartial.current !== null && key !== prevPartial.current) setLastChangeAt(Date.now());
    prevPartial.current = key;
  }, [feed]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 300);
    return () => clearInterval(t);
  }, []);
  const running = session.status === "live" || session.status === "reconnecting";
  const speaking = running && now - lastChangeAt < SPEAKING_WINDOW_MS;

  // --- Vibration on start / pause / end (skip the state we found on arrival).
  const prevStatus = useRef(session.status);
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = session.status;
    if (prev === session.status || !prefs.vibrate || !("vibrate" in navigator)) return;
    if (session.status === "live" && prev !== "reconnecting") navigator.vibrate(200);
    else if (session.status === "paused") navigator.vibrate([150, 100, 150]);
    else if (session.status === "ended") navigator.vibrate(700);
  }, [session.status, prefs.vibrate]);

  // Auto-scroll only when following live.
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!paused) bottom.current?.scrollIntoView({ block: "end" });
  }, [feed, paused]);

  const lines = feed?.lines ?? [];
  const shown = paused ? lines : lines.slice(-FOCUS_LINES);

  return (
    <main className={`flex h-dvh flex-col font-[family-name:var(--font-atkinson)] ${theme.cls}`}>
      {/* Status + speaking indicator */}
      <header className={`flex items-center gap-3 border-b px-4 py-3 ${theme.line}`}>
        <StatusIndicator status={session.status} speaking={speaking} mutedCls={theme.muted} />
        <button
          onClick={onChange}
          className={`ml-auto inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${theme.line}`}
          aria-label="Cambiar idioma o modo"
        >
          <Languages className="h-4 w-4" /> {langLabel(lang)}
        </button>
      </header>

      {/* Sign-language interpreter (human, provided by the event) */}
      {embed && prefs.showInterpreter && (
        <div className="relative h-[35dvh] shrink-0 bg-black">
          <iframe
            src={embed}
            title="Intérprete de lengua de señas en vivo"
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
      )}

      {/* Captions */}
      <section
        role="log"
        aria-live="polite"
        aria-label={`Subtítulos en ${langLabel(lang)}`}
        className={`flex-1 overflow-y-auto px-5 py-6 leading-[1.5] ${SIZES[prefs.size]} ${paused ? "" : "flex flex-col justify-end"}`}
      >
        {feed === undefined && <p className={theme.muted}>Conectando…</p>}
        {feed && lines.length === 0 && !feed.partial && <p className={theme.muted}>Esperando que empiece la charla…</p>}
        {shown.map((l, i) => (
          <p key={l.seq} className={`mb-4 ${!paused && i < shown.length - 1 && !feed?.partial ? "opacity-80" : ""}`}>
            {l.text}
          </p>
        ))}
        {!paused && feed?.partial && (
          <p className="mb-4 font-bold">
            {feed.partial}
            <span aria-hidden className="ml-1 inline-block h-[0.9em] w-[4px] translate-y-[0.1em] animate-pulse bg-current" />
          </p>
        )}
        <div ref={bottom} />
      </section>

      {/* Controls: big touch targets */}
      <footer className={`grid grid-cols-5 gap-2 border-t px-3 py-3 ${theme.line}`}>
        <Control
          label={paused ? "Volver al vivo" : "Pausar para releer"}
          short={paused ? "En vivo" : "Pausar"}
          onClick={() => setPaused((p) => !p)}
          active={paused}
          line={theme.line}
          icon={paused ? <Play className="h-6 w-6" /> : <Pause className="h-6 w-6" />}
        />
        <Control label="Achicar texto" short="Achicar" onClick={() => update({ size: Math.max(0, prefs.size - 1) })} line={theme.line} icon={<AArrowDown className="h-6 w-6" />} />
        <Control label="Agrandar texto" short="Agrandar" onClick={() => update({ size: Math.min(SIZES.length - 1, prefs.size + 1) })} line={theme.line} icon={<AArrowUp className="h-6 w-6" />} />
        <Control
          label={`Colores: ${theme.label} (tocar para cambiar)`}
          short="Colores"
          onClick={() => update({ theme: (prefs.theme + 1) % THEMES.length })}
          line={theme.line}
          icon={<Contrast className="h-6 w-6" />}
        />
        {embed ? (
          <Control
            label={prefs.showInterpreter ? "Ocultar intérprete" : "Ver intérprete"}
            short="Señas"
            onClick={() => update({ showInterpreter: !prefs.showInterpreter })}
            active={prefs.showInterpreter}
            line={theme.line}
            icon={<Hand className="h-6 w-6" />}
          />
        ) : (
          <Control
            label={prefs.vibrate ? "Vibración activada" : "Vibración desactivada"}
            short="Vibrar"
            onClick={() => update({ vibrate: !prefs.vibrate })}
            active={prefs.vibrate}
            line={theme.line}
            icon={<Vibrate className="h-6 w-6" />}
          />
        )}
      </footer>
    </main>
  );
}

function StatusIndicator({
  status,
  speaking,
  mutedCls,
}: {
  status: Doc<"sessions">["status"];
  speaking: boolean;
  mutedCls: string;
}) {
  if (status === "paused")
    return (
      <span className="inline-flex items-center gap-2 text-lg font-bold">
        <Pause className="h-5 w-5" /> La charla está en pausa
      </span>
    );
  if (status === "ended")
    return (
      <span className="inline-flex items-center gap-2 text-lg font-bold">
        <Square className="h-5 w-5" /> La charla terminó
      </span>
    );
  if (status === "error" || status === "reconnecting")
    return (
      <span className="inline-flex items-center gap-2 text-lg font-bold">
        <WifiOff className="h-5 w-5" /> Reconectando la sala…
      </span>
    );
  if (status === "idle")
    return <span className={`text-lg ${mutedCls}`}>La charla todavía no empezó</span>;
  return (
    <span className="inline-flex items-center gap-3 text-lg font-bold" aria-live="polite">
      <SpeakingBars active={speaking} />
      {speaking ? "Hablando" : <span className={mutedCls}>Silencio</span>}
    </span>
  );
}

/** Animated bars while speech is detected; flat when silent. */
function SpeakingBars({ active }: { active: boolean }) {
  return (
    <span aria-hidden className="flex h-6 items-center gap-[3px]">
      {[0, 1, 2, 3, 4].map((i) => (
        <span
          key={i}
          className="w-[4px] rounded-full bg-current transition-all duration-150"
          style={{
            height: active ? undefined : 4,
            animation: active ? `speak-bar 0.9s ${i * 0.12}s ease-in-out infinite` : "none",
          }}
        />
      ))}
      {!active && <AudioLines className="sr-only" />}
    </span>
  );
}

function Control({
  label,
  short,
  onClick,
  icon,
  active,
  line,
}: {
  label: string;
  short: string;
  onClick: () => void;
  icon: React.ReactNode;
  active?: boolean;
  line: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={`flex h-14 flex-col items-center justify-center gap-1 rounded-xl border ${line} ${active ? "bg-current/10" : ""}`}
    >
      {icon}
      <span className="text-[11px] leading-none opacity-80">{short}</span>
    </button>
  );
}
