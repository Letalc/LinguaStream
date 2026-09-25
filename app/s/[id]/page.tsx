"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { SubtitleFeed } from "@/components/SubtitleFeed";
import { LANGS, isLang, type Lang } from "@/lib/langs";
import { useWakeLock } from "@/lib/useWakeLock";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import { LagIndicator } from "@/components/LagIndicator";
import { SpeakLines } from "@/components/SpeakLines";
import { AArrowDown, AArrowUp, ArrowLeft, Contrast, Volume2, VolumeX } from "lucide-react";
import { Dot } from "@/components/ui/Dot";
import { LangBadge } from "@/components/ui/LangBadge";

const SIZES = ["text-lg", "text-2xl", "text-4xl"];

export default function AudiencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const sessionId = id as Id<"sessions">;
  const session = useQuery(api.sessions.get, { sessionId });
  const [lang, setLang] = useState<Lang | null>(null);
  const [size, setSize] = useState(1);
  const [contrast, setContrast] = useState(false);
  const [chosen, setChosen] = useState(false); // language explicitly picked on this device
  const [speak, setSpeak] = useState(false);
  useWakeLock();

  // Remember the viewer's preferences on this device.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("live-subs-prefs");
      if (saved) {
        const p = JSON.parse(saved);
        if (typeof p.size === "number") setSize(p.size);
        if (typeof p.contrast === "boolean") setContrast(p.contrast);
        if (isLang(p.lang)) {
          setLang(p.lang);
          setChosen(true);
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("live-subs-prefs", JSON.stringify({ size, contrast, lang }));
    } catch {}
  }, [size, contrast, lang]);

  if (session === undefined) return <div className="p-8 text-neutral-400">Cargando…</div>;
  if (session === null) return <div className="p-8">Sesión no encontrada.</div>;

  const available = [session.sourceLang, ...session.targetLangs];
  // Default: Spanish if available (Nerdearla's audience), else the original language.
  const current: Lang = lang && available.includes(lang) ? lang : available.includes("es") ? "es" : session.sourceLang;

  if (!chosen) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6">
        <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.3em] text-accent"><Dot className="bg-accent" pulse /> {session.code ?? "EN VIVO"}</p>
        <h1 className="mt-2 text-2xl font-semibold">{session.title}</h1>
        <p className="mt-1 text-sm text-neutral-400">{session.room}{session.speaker && ` · ${session.speaker}`}</p>
        <p className="mt-10 text-neutral-300">¿En qué idioma querés los subtítulos?</p>
        <div className="mt-4 space-y-3">
          {LANGS.filter((l) => available.includes(l.code)).map((l) => (
            <button
              key={l.code}
              onClick={() => {
                setLang(l.code);
                setChosen(true);
              }}
              className="flex w-full items-center gap-4 rounded-2xl border border-neutral-800 bg-neutral-950 px-5 py-4 text-left text-lg hover:border-cyan-300"
            >
              <LangBadge code={l.code} className="text-accent" />
              <span className="flex-1">{l.label}</span>
              {l.code === session.sourceLang && <span className="text-xs text-neutral-500">original</span>}
            </button>
          ))}
        </div>
      </main>
    );
  }

  return (
    <main className={`flex h-dvh flex-col ${contrast ? "bg-black text-yellow-300" : ""}`}>
      <ConnectionBadge />
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
              className={`rounded-full px-3 py-1 ${current === l.code ? "bg-white text-black" : "border border-neutral-700"}`}
            >
              <span className="inline-flex items-center gap-1.5"><LangBadge code={l.code} className="h-5 min-w-7 text-[10px]" /> {l.label}</span>
              {l.code === session.sourceLang && <span className="ml-1 text-xs opacity-60">(original)</span>}
            </button>
          ))}
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
