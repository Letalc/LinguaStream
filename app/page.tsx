"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { langLabel } from "@/lib/langs";

export default function Home() {
  const sessions = useQuery(api.sessions.list);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Subtítulos en vivo</h1>
      <p className="mt-2 text-neutral-400">
        Elegí la charla y el idioma. Los subtítulos aparecen en tiempo real en tu celular.
      </p>

      <ul className="mt-8 space-y-3">
        {sessions === undefined && <li className="text-neutral-500">Cargando…</li>}
        {sessions?.length === 0 && <li className="text-neutral-500">Todavía no hay sesiones.</li>}
        {sessions?.map((s) => (
          <li key={s._id}>
            <Link
              href={`/s/${s._id}`}
              className="flex items-center justify-between gap-4 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 hover:border-neutral-600"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{s.title}</p>
                <p className="truncate text-sm text-neutral-400">
                  {s.room}
                  {s.speaker && ` · ${s.speaker}`} · {[s.sourceLang, ...s.targetLangs].map(langLabel).join(" / ")}
                </p>
              </div>
              {s.status === "live" || s.status === "reconnecting" ? (
                <span className="flex shrink-0 items-center gap-1.5 text-sm text-red-400">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> EN VIVO
                </span>
              ) : (
                <span className="shrink-0 text-sm text-neutral-500">{s.status === "ended" ? "Finalizada" : "Próximamente"}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-12 text-center text-xs text-neutral-600">
        Open source · <Link href="/admin" className="underline">Producción</Link>
      </p>
    </main>
  );
}
