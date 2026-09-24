"use client";

import { useMutation, useQuery, useAction } from "convex/react";
import { use, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AdminGate } from "@/components/AdminGate";
import { LiveTranscriber, type TranscriberStatus } from "@/lib/live-transcriber";
import { startCapture, listInputDevices } from "@/lib/audio-capture";
import { langLabel } from "@/lib/langs";
import { SubtitleFeed } from "@/components/SubtitleFeed";

export default function ConsolePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <AdminGate>{(key) => <Console adminKey={key} sessionId={id as Id<"sessions">} />}</AdminGate>;
}

const STATUS_STYLE: Record<string, string> = {
  idle: "bg-neutral-700",
  connecting: "bg-amber-500",
  live: "bg-emerald-500",
  reconnecting: "bg-amber-500 animate-pulse",
  paused: "bg-sky-500",
  error: "bg-red-500",
  stopped: "bg-neutral-700",
  ended: "bg-neutral-700",
};

function Console({ adminKey, sessionId }: { adminKey: string; sessionId: Id<"sessions"> }) {
  const session = useQuery(api.sessions.get, { sessionId });
  const claim = useMutation(api.sessions.claim);
  const setStatus = useMutation(api.sessions.setStatus);
  const heartbeat = useMutation(api.sessions.heartbeat);
  const setPartial = useMutation(api.segments.setPartial);
  const commitSource = useMutation(api.segments.commitSource);
  const createToken = useAction(api.gemini.createLiveToken);

  // A random id per tab: the backend lets only one console own a session.
  const [consoleId] = useState(() => crypto.randomUUID());
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [source, setSource] = useState<string>("tab");
  const [state, setState] = useState<TranscriberStatus | "idle" | "paused">("idle");
  const [lastError, setLastError] = useState<string | null>(null);
  const [level, setLevel] = useState(0);
  const [inputLabel, setInputLabel] = useState("");
  const [debug, setDebug] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(false);

  const transcriber = useRef<LiveTranscriber | null>(null);
  const capture = useRef<{ stop: () => void } | null>(null);
  const paused = useRef(false);
  const partialTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPartial = useRef("");

  useEffect(() => {
    listInputDevices().then(setDevices).catch(() => {});
  }, []);

  // Heartbeat so the dashboard knows this room is alive.
  const running = state === "live" || state === "reconnecting" || state === "paused" || state === "connecting";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => {
      heartbeat({ key: adminKey, sessionId, consoleId }).catch(() => {});
    }, 5000);
    return () => clearInterval(t);
  }, [running, adminKey, sessionId, consoleId, heartbeat]);

  const pushPartial = useCallback(
    (text: string) => {
      // Throttle partial writes to ~4/s: plenty for reading, cheap for the backend.
      latestPartial.current = text;
      if (partialTimer.current) return;
      partialTimer.current = setTimeout(() => {
        partialTimer.current = null;
        if (!session) return;
        setPartial({
          key: adminKey,
          sessionId,
          consoleId,
          lang: session.sourceLang,
          text: latestPartial.current,
        }).catch(() => {});
      }, 250);
    },
    [adminKey, sessionId, consoleId, session, setPartial],
  );

  const start = async (force = false) => {
    setLastError(null);
    const res = await claim({ key: adminKey, sessionId, consoleId, force });
    if (!res.ok) {
      if (confirm(`${res.reason}. ¿Tomar el control desde esta pestaña?`)) return start(true);
      return;
    }
    setState("connecting");
    const t = new LiveTranscriber({
      getToken: () => createToken({ key: adminKey, sessionId }),
      onPartial: pushPartial,
      onCommit: (line) => {
        commitSource({
          key: adminKey,
          sessionId,
          consoleId,
          text: line.text,
          startMs: line.startMs,
          endMs: line.endMs,
          latencyMs: line.latencyMs,
          remainingPartial: line.remaining,
        }).catch((e) => setLastError(String(e)));
      },
      onStatus: (s, err) => {
        setState(s);
        if (err) setLastError(err);
        const backendStatus = s === "connecting" ? "live" : s === "stopped" ? "ended" : s;
        setStatus({ key: adminKey, sessionId, consoleId, status: backendStatus, error: err }).catch(() => {});
      },
      onDebug: (msg) =>
        setDebug((d) => [JSON.stringify(msg).slice(0, 300), ...d].slice(0, 60)),
    });
    transcriber.current = t;
    try {
      const cap = await startCapture(
        source === "tab" ? { kind: "tab" } : { kind: "mic", deviceId: source || undefined },
        (pcm, rms) => {
          setLevel(rms);
          if (!paused.current) t.pushAudio(pcm, rms);
        },
      );
      capture.current = cap;
      setInputLabel(cap.label);
      await t.start();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setLastError(msg);
      setState("error");
      capture.current?.stop();
      setStatus({ key: adminKey, sessionId, consoleId, status: "error", error: msg }).catch(() => {});
    }
  };

  const stop = async () => {
    capture.current?.stop();
    capture.current = null;
    await transcriber.current?.stop();
    transcriber.current = null;
    setLevel(0);
  };

  const togglePause = () => {
    paused.current = !paused.current;
    const s = paused.current ? "paused" : "live";
    setState(s);
    setStatus({ key: adminKey, sessionId, consoleId, status: s }).catch(() => {});
  };

  useEffect(() => () => void stop(), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined) return <div className="p-8 text-neutral-400">Cargando…</div>;
  if (session === null) return <div className="p-8">Sesión no encontrada.</div>;

  const langs = [session.sourceLang, ...session.targetLangs];

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link href="/admin" className="text-sm text-neutral-400 hover:text-white">← Panel</Link>
          <h1 className="mt-1 text-2xl font-semibold">{session.title}</h1>
          <p className="text-sm text-neutral-400">
            {session.room} · {session.speaker ?? "—"} · origen {langLabel(session.sourceLang)}
            {session.targetLangs.length > 0 && ` → ${session.targetLangs.map(langLabel).join(", ")}`}
          </p>
        </div>
        <span className="flex items-center gap-2 rounded-full border border-neutral-800 px-3 py-1 text-sm">
          <span className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLE[state] ?? "bg-neutral-700"}`} />
          {state}
        </span>
      </div>

      <section className="mt-6 rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={source}
            disabled={running}
            onChange={(e) => setSource(e.target.value)}
            className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          >
            <option value="tab">Audio de una pestaña / pantalla</option>
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                🎙 {d.label || "Micrófono"}
              </option>
            ))}
            {devices.length === 0 && <option value="">🎙 Micrófono por defecto</option>}
          </select>

          {!running ? (
            <button onClick={() => start()} className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-black">
              Iniciar
            </button>
          ) : (
            <>
              <button onClick={togglePause} className="rounded-lg border border-neutral-700 px-4 py-2">
                {state === "paused" ? "Reanudar" : "Pausar"}
              </button>
              <button onClick={stop} className="rounded-lg bg-red-500 px-4 py-2 font-medium text-black">
                Terminar
              </button>
              <button
                onClick={() => transcriber.current?.simulateDrop()}
                className="rounded-lg border border-neutral-800 px-3 py-2 text-xs text-neutral-400"
                title="Cierra la conexión con Gemini para probar la reconexión automática"
              >
                Simular corte
              </button>
            </>
          )}

          <div className="ml-auto flex items-center gap-2 text-xs text-neutral-400">
            <span className="max-w-48 truncate">{inputLabel}</span>
            <div className="h-2 w-40 overflow-hidden rounded bg-neutral-800">
              <div
                className="h-full bg-emerald-400 transition-[width] duration-75"
                style={{ width: `${Math.min(100, level * 400)}%` }}
              />
            </div>
          </div>
        </div>
        {lastError && <p className="mt-3 text-sm text-amber-400">⚠ {lastError}</p>}
      </section>

      <div className={`mt-6 grid gap-4 ${langs.length > 1 ? "md:grid-cols-2" : ""}`}>
        {langs.map((lang) => (
          <div key={lang} className="rounded-2xl border border-neutral-800 p-4">
            <h2 className="mb-2 text-xs uppercase tracking-wide text-neutral-500">{langLabel(lang)}</h2>
            <SubtitleFeed sessionId={sessionId} lang={lang} className="h-72 text-lg" />
          </div>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-4 text-sm text-neutral-400">
        <Link className="underline" href={`/s/${sessionId}`} target="_blank">Vista audiencia</Link>
        <Link className="underline" href={`/overlay/${sessionId}?lang=${session.targetLangs[0] ?? session.sourceLang}`} target="_blank">Overlay OBS</Link>
        <button className="underline" onClick={() => setShowDebug((x) => !x)}>Debug</button>
      </div>
      {showDebug && (
        <pre className="mt-3 max-h-80 overflow-auto rounded-lg bg-neutral-950 p-3 text-xs text-neutral-400">
          {debug.join("\n")}
        </pre>
      )}
    </main>
  );
}
