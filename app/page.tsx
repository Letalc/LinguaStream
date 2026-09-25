"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { langLabel } from "@/lib/langs";
import { Dot } from "@/components/ui/Dot";
import { Ear } from "@/components/ui/NeonIcon";

/** Audience landing: type the room code shown on the projector, or pick a live talk. */
export default function Home() {
  const [conferenceId, setConferenceId] = useState<Id<"conferences"> | undefined>(undefined);
  const conferences = useQuery(api.conferences.list);
  const sessions = useQuery(api.sessions.list, { conferenceId });
  const router = useRouter();
  const [code, setCode] = useState("");
  const live = sessions?.filter((s) => s.status === "live" || s.status === "reconnecting" || s.status === "paused") ?? [];

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-12">
      <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.3em] text-accent"><Dot className="bg-accent" pulse /> SUBTÍTULOS EN VIVO</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight">Entendé cada charla, en tu idioma.</h1>
      <p className="mt-3 text-neutral-400">
        Transcripción y traducción simultánea con IA. Sin registro: ingresá el código de la sala o escaneá el QR.
      </p>

      <p className="mt-4 flex items-center gap-2 text-sm text-yellow-300/90">
        <Ear className="h-4 w-4 shrink-0" /> Incluye un modo accesible para personas sordas o con hipoacusia.
      </p>

      <form
        className="mt-8 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.trim().toUpperCase();
          if (c) router.push(`/r/${c}`);
        }}
      >
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 6))}
          placeholder="CÓDIGO"
          autoCapitalize="characters"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-xl border border-neutral-800 bg-neutral-950 px-4 py-4 text-center font-mono text-2xl tracking-[0.4em] placeholder:text-neutral-700"
        />
        <button className="rounded-xl bg-cyan-300 px-6 font-mono font-semibold tracking-widest text-black">ENTRAR</button>
      </form>

      {conferences && conferences.length > 0 && (
        <div className="mt-8 flex flex-wrap gap-2">
          <button
            onClick={() => setConferenceId(undefined)}
            className={`rounded-full px-3 py-1 font-mono text-xs transition ${
              conferenceId === undefined
                ? "bg-accent/20 text-accent border border-accent/40"
                : "border border-neutral-800 text-neutral-400 hover:border-neutral-700"
            }`}
          >
            Todas las conferencias
          </button>
          {conferences.map((c) => (
            <button
              key={c._id}
              onClick={() => setConferenceId(c._id)}
              className={`rounded-full px-3 py-1 font-mono text-xs transition ${
                conferenceId === c._id
                  ? "bg-accent/20 text-accent border border-accent/40"
                  : "border border-neutral-800 text-neutral-400 hover:border-neutral-700"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <h2 className="mt-12 font-mono text-[11px] tracking-[0.3em] text-neutral-500">EN VIVO AHORA</h2>
      <ul className="mt-3 space-y-2">
        {sessions === undefined && <li className="text-neutral-500">Cargando…</li>}
        {sessions && live.length === 0 && <li className="text-sm text-neutral-500">No hay charlas en vivo en este momento.</li>}
        {live.map((s) => (
          <li key={s._id}>
            <Link
              href={`/s/${s._id}`}
              className="flex items-center justify-between gap-4 rounded-xl border border-neutral-800 bg-neutral-950 p-4 hover:border-neutral-600"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{s.title}</p>
                <p className="truncate text-sm text-neutral-400">
                  {s.room}
                  {s.speaker && ` · ${s.speaker}`} · {[s.sourceLang, ...s.targetLangs].map(langLabel).join(" / ")}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-red-400">
                <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> {s.code ?? "LIVE"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-16 text-center text-xs text-neutral-600">
        Open source · Gemini Live · <Link href="/admin" className="underline">Acceso Host</Link>
      </p>
    </main>
  );
}
