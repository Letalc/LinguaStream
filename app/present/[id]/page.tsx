"use client";

import { useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { Suspense, use, useEffect, useRef, useState } from "react";
import { Maximize, MonitorUp, Square } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { LANGS, type Lang } from "@/lib/langs";
import { overlayOptions } from "@/lib/overlay-options";

export default function PresentationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <Suspense>
      <PresentationOutput sessionId={id as Id<"sessions">} />
    </Suspense>
  );
}

function PresentationOutput({ sessionId }: { sessionId: Id<"sessions"> }) {
  const query = useSearchParams();
  const defaults = overlayOptions(query);
  const session = useQuery(api.sessions.get, { sessionId });
  const [picked, setPicked] = useState<Lang | null>(query.get("lang") ? defaults.lang : null);
  const [size, setSize] = useState(defaults.size);
  const [box, setBox] = useState(defaults.box);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const available: Lang[] = session ? [session.sourceLang, ...session.targetLangs] : [];
  // Only languages this room produces: ?lang= if valid, else Spanish when offered, else the original.
  const lang: Lang = picked && available.includes(picked) ? picked : available.includes("es") ? "es" : (session?.sourceLang ?? defaults.lang);
  const feed = useQuery(api.segments.feed, session ? { sessionId, lang, limit: defaults.lines } : "skip");

  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
    return () => {
      for (const track of stream?.getTracks() ?? []) track.stop();
    };
  }, [stream]);

  const selectPresentation = async () => {
    setError(null);
    try {
      const selected = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      for (const track of stream?.getTracks() ?? []) track.stop();
      selected.getVideoTracks()[0]?.addEventListener("ended", () => setStream(null), { once: true });
      setStream(selected);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "NotAllowedError") return;
      setError(cause instanceof Error ? cause.message : "No se pudo compartir la presentación.");
    }
  };

  if (session === undefined) return <main className="p-8 text-neutral-400">Cargando…</main>;
  if (session === null) return <main className="p-8">Sesión no encontrada.</main>;

  const lines = [...(feed?.lines.map((line) => line.text) ?? []), ...(feed?.partial ? [feed.partial] : [])].slice(-defaults.lines);

  return (
    <main className="min-h-dvh bg-[#05070a] p-4 text-white">
      <header className="mx-auto mb-4 flex max-w-7xl flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-3">
        <div className="mr-auto min-w-48">
          <p className="font-medium">{session.title}</p>
          <p className="text-xs text-neutral-400">Salida para proyector o captura de producción</p>
        </div>
        <select value={lang} onChange={(event) => setPicked(event.target.value as Lang)} className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm">
          {LANGS.filter((item) => available.includes(item.code)).map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          Texto
          <input aria-label="Tamaño de los subtítulos" type="range" min="28" max="80" value={size} onChange={(event) => setSize(Number(event.target.value))} />
        </label>
        <button onClick={() => setBox((value) => !value)} className="rounded-lg border border-neutral-700 px-3 py-2 text-sm">{box ? "Fondo CC: sí" : "Fondo CC: no"}</button>
        <button onClick={selectPresentation} className="inline-flex items-center gap-2 rounded-lg bg-cyan-300 px-3 py-2 text-sm font-semibold text-black"><MonitorUp className="h-4 w-4" /> Elegir presentación</button>
        <button onClick={() => stage.current?.requestFullscreen()} className="inline-flex items-center gap-2 rounded-lg border border-neutral-700 px-3 py-2 text-sm"><Maximize className="h-4 w-4" /> Pantalla completa</button>
      </header>
      {error && <p className="mx-auto mb-4 max-w-7xl text-sm text-red-400">{error}</p>}

      <div ref={stage} className="relative mx-auto aspect-video max-h-[calc(100dvh-7rem)] max-w-7xl overflow-hidden bg-black shadow-2xl">
        {stream ? (
          <video ref={video} autoPlay muted playsInline className="h-full w-full object-contain" />
        ) : (
          <button onClick={selectPresentation} className="absolute inset-0 flex flex-col items-center justify-center gap-4 text-neutral-400">
            <MonitorUp className="h-16 w-16 text-cyan-300" />
            <span className="text-xl">Elegí la ventana, pestaña o pantalla que contiene las diapositivas</span>
          </button>
        )}
        {stream && lines.length === 0 && (
          <p className="pointer-events-none absolute inset-x-0 bottom-[4%] text-center text-sm text-neutral-300 [text-shadow:0_1px_4px_#000]">
            {session.status === "live" || session.status === "reconnecting"
              ? `Esperando subtítulos en ${LANGS.find((l) => l.code === lang)?.label ?? lang}…`
              : "La sala no está transmitiendo: iniciá la consola para ver los subtítulos."}
          </p>
        )}
        {lines.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 bottom-[4%] flex justify-center px-[4%]">
            <div className="max-w-[92%] rounded-xl px-6 py-3 text-center font-semibold leading-snug" style={{ fontSize: size, background: box ? "rgba(0,0,0,.76)" : "transparent", textShadow: box ? "none" : "0 2px 6px #000, 0 0 2px #000" }}>
              {lines.map((line, index) => <p key={`${index}-${line}`}>{line}</p>)}
            </div>
          </div>
        )}
        {stream && (
          <button aria-label="Dejar de compartir presentación" onClick={() => { for (const track of stream.getTracks()) track.stop(); setStream(null); }} className="absolute right-4 top-4 rounded-full bg-black/70 p-2 text-neutral-200"><Square className="h-5 w-5" /></button>
        )}
      </div>
    </main>
  );
}
