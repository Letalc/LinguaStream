"use client";

import { useQuery } from "convex/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { isStale, type DashboardSession } from "./health";
import { TriangleAlert } from "@/components/ui/NeonIcon";

type Tone = "danger" | "warn" | "ok" | "info";
type Toast = { id: string; tone: Tone; title: string; body: string };

const EVENT_META: Record<string, { tone: Tone; label: string }> = {
  created: { tone: "info", label: "Sesión creada" },
  started: { tone: "ok", label: "En vivo" },
  recovered: { tone: "ok", label: "Recuperada" },
  reconnecting: { tone: "warn", label: "Reconectando" },
  paused: { tone: "info", label: "Pausada" },
  error: { tone: "danger", label: "Error" },
  ended: { tone: "info", label: "Finalizada" },
};

const TONE_TEXT: Record<Tone, string> = {
  danger: "text-red-400",
  warn: "text-amber-400",
  ok: "text-accent",
  info: "text-neutral-400",
};

/** Side panel: the latest status transitions of every room (reactive). */
export function AlertsFeed() {
  const events = useQuery(api.events.recent, { limit: 20 });
  return (
    <section className="rounded-md border border-line bg-panel p-5">
      <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-neutral-300"><TriangleAlert className="h-3.5 w-3.5" /> Alertas</h2>
      <ul className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
        {events?.length === 0 && <li className="font-mono text-[11px] text-neutral-600">Sin eventos todavía.</li>}
        {events?.map((e) => {
          const meta = EVENT_META[e.type] ?? { tone: "info" as Tone, label: e.type };
          return (
            <li key={e._id} className="border-l border-line pl-3">
              <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em]">
                <span className={TONE_TEXT[meta.tone]}>{meta.label}</span>
                <span className="text-neutral-600">{timeAgo(e._creationTime)}</span>
              </p>
              <p className="truncate text-sm text-neutral-300">
                {e.title} <span className="text-neutral-600">· {e.room}</span>
              </p>
              {e.message && <p className="truncate font-mono text-[11px] text-neutral-500">{e.message}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Pops a toast (and a short beep) when a room ends, fails, reconnects or loses signal.
 * Backend transitions come from the `events` table; "no signal" is detected here from
 * heartbeats, because nothing is written when a laptop simply disappears.
 */
export function AlertToasts({ sessions, now, sound }: { sessions: DashboardSession[] | undefined; now: number; sound: boolean }) {
  const events = useQuery(api.events.recent, { limit: 20 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seenEvents = useRef<Set<string> | null>(null);
  const staleBefore = useRef<Set<string> | null>(null);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  useEffect(() => {
    const active = timers.current;
    return () => { for (const timer of active) clearTimeout(timer); active.clear(); };
  }, []);

  const push = useEffectEvent((t: Toast) => {
    // Deliver notifications asynchronously after the subscription update.
    const delivery = setTimeout(() => {
      timers.current.delete(delivery);
      setToasts((prev) => [t, ...prev.filter((x) => x.id !== t.id)].slice(0, 4));
      if (sound && t.tone !== "ok" && t.tone !== "info") beep(t.tone === "danger" ? 440 : 660);
      const expiry = setTimeout(() => {
        setToasts((prev) => prev.filter((x) => x.id !== t.id));
        timers.current.delete(expiry);
      }, 7000);
      timers.current.add(expiry);
    }, 0);
    timers.current.add(delivery);
  });

  // Backend events: toast only the ones that arrive after the page loaded.
  useEffect(() => {
    if (!events) return;
    if (seenEvents.current === null) {
      seenEvents.current = new Set(events.map((e) => e._id));
      return;
    }
    for (const e of [...events].reverse()) {
      if (seenEvents.current.has(e._id)) continue;
      seenEvents.current.add(e._id);
      if (e.type === "created" || e.type === "paused") continue;
      const meta = EVENT_META[e.type];
      push({ id: e._id, tone: meta.tone, title: `${meta.label} · ${e.room}`, body: e.message ? `${e.title} — ${e.message}` : e.title });
    }
  }, [events]);

  // Client-side "no signal" detection.
  useEffect(() => {
    if (!sessions) return;
    const staleNow = new Set(sessions.filter((s) => isStale(s, now)).map((s) => s._id as string));
    // First render: rooms that were already down are shown in the funnel, not toasted.
    if (staleBefore.current === null) {
      staleBefore.current = staleNow;
      return;
    }
    for (const s of sessions) {
      if (staleNow.has(s._id) && !staleBefore.current.has(s._id)) {
        push({ id: `stale-${s._id}-${now}`, tone: "danger", title: `Sin señal · ${s.room}`, body: `${s.title}: la consola dejó de responder` });
      }
    }
    staleBefore.current = staleNow;
  }, [sessions, now]);

  return (
    <div className="pointer-events-none fixed bottom-14 right-4 z-50 flex w-80 flex-col-reverse gap-2" aria-live="assertive">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast-in pointer-events-auto rounded-md border bg-panel/95 p-3 shadow-2xl backdrop-blur ${
            t.tone === "danger" ? "border-danger/70" : t.tone === "warn" ? "border-amber-500/50" : "border-line"
          }`}
        >
          <p className={`font-mono text-[10px] uppercase tracking-[0.25em] ${TONE_TEXT[t.tone]}`}>{t.title}</p>
          <p className="mt-1 text-sm text-neutral-200">{t.body}</p>
        </div>
      ))}
    </div>
  );
}

function beep(freq: number) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => void ctx.close();
  } catch {}
}

function timeAgo(t: number) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.round(s / 3600)}h`;
}
