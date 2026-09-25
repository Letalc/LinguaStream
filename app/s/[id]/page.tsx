"use client";

import "@/lib/crypto-compat";

import { useQuery } from "convex/react";
import Link from "next/link";
import { use, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { SubtitleFeed } from "@/components/SubtitleFeed";
import { LANGS, isLang, type Lang } from "@/lib/langs";
import { useWakeLock } from "@/lib/useWakeLock";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { LagIndicator } from "@/components/LagIndicator";
import { SpeakLines } from "@/components/SpeakLines";
import { AArrowDown, AArrowUp, ArrowLeft, Contrast, Languages, Volume2, VolumeX, Users } from "lucide-react";
import usePresence from "@convex-dev/presence/react";
import { JoinDialog, type JoinChoice, type ViewMode } from "@/components/JoinDialog";
import { AccessibleView } from "@/components/AccessibleView";
import { useStoredState, useHydrated } from "@/lib/useStoredState";
import { LangBadge } from "@/components/ui/LangBadge";

const SIZES = ["text-lg", "text-2xl", "text-4xl"];
type Preferences = { lang: Lang | null; size: number; contrast: boolean; mode: ViewMode };
const DEFAULT_PREFS: Preferences = { lang: null, size: 1, contrast: false, mode: "standard" };
function decodePreferences(raw: string): Preferences {
  const p = JSON.parse(raw);
  return {
    lang: isLang(p?.lang) ? p.lang : null,
    size: Number.isInteger(p?.size) ? Math.max(0, Math.min(SIZES.length - 1, p.size)) : 1,
    contrast: p?.contrast === true,
    mode: p?.mode === "accessible" ? "accessible" : "standard",
  };
}
const decodeJoined = (raw: string) => raw === "1" || raw === "true";

export default function AudiencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sessionId = id as Id<"sessions">;
  const session = useQuery(api.sessions.get, { sessionId });
  const [prefs, setPrefs] = useStoredState("live-subs-prefs", DEFAULT_PREFS, decodePreferences);
  const { lang, size, contrast, mode } = prefs;
  const setLang = (lang: Lang) => setPrefs((p) => ({ ...p, lang }));
  const setSize = (update: (size: number) => number) => setPrefs((p) => ({ ...p, size: update(p.size) }));
  const setContrast = (update: (contrast: boolean) => boolean) => setPrefs((p) => ({ ...p, contrast: update(p.contrast) }));
  const [joined, setJoined] = useStoredState(`joined:${id}`, false, decodeJoined, "sessionStorage");
  const hydrated = useHydrated();
  const [picking, setPicking] = useState(false); // "Cambiar" reopens the dialog
  const [speak, setSpeak] = useState(false);
  useWakeLock();

  const [viewerId] = useState(() => {
    if (typeof window === "undefined") return "anon";
    try {
      let vid = localStorage.getItem("live-subs-viewer-id");
      if (!vid) {
        vid = "viewer-" + Math.random().toString(36).slice(2, 10);
        localStorage.setItem("live-subs-viewer-id", vid);
      }
      return vid;
    } catch {
      return "viewer-" + Math.random().toString(36).slice(2, 10);
    }
  });

  const presenceState = usePresence(api.presence, id, viewerId);
  const viewerCount = Math.max(1, presenceState?.filter((p) => p.online).length ?? 1);
  const confirmJoin = (c: JoinChoice) => {
    setPrefs((p) => ({ ...p, lang: c.lang, mode: c.mode }));
    setJoined(true);
    setPicking(false);
  };

  if (session === undefined) return <div className="p-8 text-neutral-400">Cargando…</div>;
  if (session === null) return <div className="p-8">Sesión no encontrada.</div>;

  const available = [session.sourceLang, ...session.targetLangs];
  // Default: Spanish if available (Nerdearla's audience), else the original language.
  const current: Lang = lang && available.includes(lang) ? lang : available.includes("es") ? "es" : session.sourceLang;

  const dialog = (hydrated && !joined || picking) && (
    <JoinDialog
      title={session.title}
      subtitle={`${session.room}${session.speaker ? ` · ${session.speaker}` : ""}${session.code ? ` · Código ${session.code}` : ""}`}
      available={available}
      sourceLang={session.sourceLang}
      initial={{ lang: current, mode }}
      onConfirm={confirmJoin}
      onCancel={picking ? () => setPicking(false) : undefined}
    />
  );

  if (mode === "accessible" && joined) {
    return (
      <>
        <ConnectionBadge />
        {dialog}
        <AccessibleView session={session} sessionId={sessionId} lang={current} onChange={() => setPicking(true)} />
      </>
    );
  }

  return (
    <main className={`flex h-dvh flex-col ${contrast ? "bg-black text-yellow-300" : ""}`}>
      <ConnectionBadge />
      {dialog}
      <header className="border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <Link href="/" className="text-neutral-400" aria-label="Volver"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-medium">{session.title}</h1>
            <p className="truncate text-xs text-neutral-400">{session.room}{session.speaker && ` · ${session.speaker}`}</p>
          </div>
          {(session.status === "live" || session.status === "reconnecting") && (
            <span className="flex items-center gap-1.5 text-xs text-red-400">
              <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> EN VIVO
            </span>
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          {LANGS.filter((l) => available.includes(l.code)).map((l) => (
            <button
              key={l.code}
              onClick={() => setLang(l.code)}
              className={`hidden rounded-full px-3 py-1 sm:inline-block ${current === l.code ? "bg-white text-black" : "border border-neutral-700"}`}
            >
              <span className="inline-flex items-center gap-1.5"><LangBadge code={l.code} className="h-5 min-w-7 text-[10px]" /> {l.label}</span>
              {l.code === session.sourceLang && <span className="ml-1 text-xs opacity-60">(original)</span>}
            </button>
          ))}
          <button
            onClick={() => setPicking(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-neutral-700 px-3 py-1 text-xs text-neutral-300"
          >
            <Languages className="h-3.5 w-3.5" /> Cambiar
          </button>
          <div className="ml-auto flex items-center gap-1">
            <button aria-label="Achicar texto" className="rounded border border-neutral-700 px-2" onClick={() => setSize((s) => Math.max(0, s - 1))}><AArrowDown className="h-4 w-4" /></button>
            <button aria-label="Agrandar texto" className="rounded border border-neutral-700 px-2" onClick={() => setSize((s) => Math.min(SIZES.length - 1, s + 1))}><AArrowUp className="h-4 w-4" /></button>
            <button aria-label="Alto contraste" className="rounded border border-neutral-700 px-2" onClick={() => setContrast((c) => !c)}><Contrast className="h-4 w-4" /></button>
            <button
              aria-label="Escuchar la traducción"
              aria-pressed={speak}
              className={`rounded border px-2 ${speak ? "border-cyan-300 text-cyan-300" : "border-neutral-700"}`}
              onClick={() => setSpeak((x) => !x)}
            >
              {speak ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </header>
      <SubtitleFeed sessionId={sessionId} lang={current} className={`flex-1 px-4 py-4 ${SIZES[size]}`} limit={100} />
      {speak && <SpeakLines key={current} sessionId={sessionId} lang={current} />}
      <footer className="flex items-center gap-4 border-t border-neutral-800 px-4 py-2 text-sm">
        <span className="flex items-center gap-1.5 text-xs text-neutral-400">
          <Users className="h-3.5 w-3.5" /> {viewerCount} {viewerCount === 1 ? "espectador" : "espectadores"}
        </span>
        {session.status === "ended" ? (
          <>
            <span className="text-neutral-400">Descargar:</span>
            {(["txt", "srt", "vtt"] as const).map((f) => (
              <a key={f} className="underline" href={`/api/export/${sessionId}?lang=${current}&format=${f}`}>{f.toUpperCase()}</a>
            ))}
          </>
        ) : (
          <span className="text-xs text-neutral-500">Subtítulos generados por IA en tiempo real</span>
        )}
        <span className="ml-auto">
          <LagIndicator sessionId={sessionId} lang={current} limit={100} />
        </span>
      </footer>
    </main>
  );
}
