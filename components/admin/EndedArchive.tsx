"use client";

import { Search } from "lucide-react";
import { Archive, ChevronDown, Download, FolderClosed, FolderOpen } from "@/components/ui/NeonIcon";
import { useMemo, useState } from "react";
import { LangBadge } from "@/components/ui/LangBadge";
import { DeleteButton } from "./SessionCard";
import type { DashboardSession } from "./health";

/**
 * Finished talks as a collapsible archive (a "folder") with a compact table grouped by
 * day, instead of one big card per talk. Each row links to its transcripts.
 */
export function EndedArchive({
  sessions,
  adminKey,
  open,
  onToggle,
}: {
  sessions: DashboardSession[];
  adminKey: string;
  open: boolean;
  onToggle: () => void;
}) {
  const [q, setQ] = useState("");

  const days = useMemo(() => {
    const filtered = sessions
      .filter((s) => s.title.toLowerCase().includes(q.trim().toLowerCase()) || s.room.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => endTime(b) - endTime(a));
    const byDay = new Map<string, DashboardSession[]>();
    for (const s of filtered) {
      const day = new Date(endTime(s)).toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
      byDay.set(day, [...(byDay.get(day) ?? []), s]);
    }
    return [...byDay.entries()];
  }, [sessions, q]);

  return (
    <section className="rounded-md border border-line bg-panel">
      <button onClick={onToggle} className="flex w-full items-center gap-3 px-5 py-4 text-left" aria-expanded={open}>
        {open ? <FolderOpen className="h-5 w-5 text-neutral-400" /> : <FolderClosed className="h-5 w-5 text-neutral-400" />}
        <span className="font-mono text-[11px] uppercase tracking-[0.3em] text-neutral-300">Archivo · Finalizadas</span>
        <span className="rounded-sm bg-black/50 px-1.5 font-mono text-[11px] text-neutral-400">{sessions.length}</span>
        <span className="ml-auto text-xs text-neutral-400">Registro de charlas terminadas y sus transcripciones</span>
        <ChevronDown className={`h-4 w-4 text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-line px-5 pb-5">
          <label className="mt-4 flex items-center gap-2 rounded-sm border border-line bg-black/40 px-3 py-2">
            <Search className="h-4 w-4 text-neutral-400" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por título o sala"
              className="w-full bg-transparent font-mono text-xs outline-none placeholder:text-neutral-500"
            />
          </label>

          {days.length === 0 && (
            <p className="mt-6 flex items-center gap-2 text-sm text-neutral-400">
              <Archive className="h-4 w-4" /> No hay charlas terminadas{q && " con ese nombre"}.
            </p>
          )}

          {days.map(([day, rows]) => (
            <div key={day} className="mt-6">
              <h3 className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-400">{day}</h3>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b border-line text-left font-mono text-[9px] uppercase tracking-[0.25em] text-neutral-400">
                      <th className="py-2 pr-3 font-normal">Charla</th>
                      <th className="py-2 pr-3 font-normal">Fin</th>
                      <th className="py-2 pr-3 font-normal">Duración</th>
                      <th className="py-2 pr-3 text-right font-normal">Líneas</th>
                      <th className="py-2 pr-3 text-right font-normal">Latencia</th>
                      <th className="py-2 pr-3 text-right font-normal">Errores</th>
                      <th className="py-2 pr-3 font-normal">Transcripciones</th>
                      <th className="py-2 font-normal" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => (
                      <tr key={s._id} className="border-b border-line/60 align-top last:border-0">
                        <td className="max-w-64 py-3 pr-3">
                          <p className="truncate font-medium">{s.title}</p>
                          <p className="truncate font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-400">
                            {s.room}{s.code ? ` · ${s.code}` : ""}
                          </p>
                        </td>
                        <td className="py-3 pr-3 font-mono text-xs text-neutral-400">
                          {new Date(endTime(s)).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="py-3 pr-3 font-mono text-xs text-neutral-400">{duration(s)}</td>
                        <td className="py-3 pr-3 text-right font-mono text-xs">{s.stats?.segmentCount ?? 0}</td>
                        <td className="py-3 pr-3 text-right font-mono text-xs">
                          {s.stats?.avgLatencyMs != null ? `${(s.stats.avgLatencyMs / 1000).toFixed(1)}s` : "—"}
                        </td>
                        <td className={`py-3 pr-3 text-right font-mono text-xs ${(s.stats?.errorCount ?? 0) > 0 ? "text-amber-400" : ""}`}>
                          {s.stats?.errorCount ?? 0}
                        </td>
                        <td className="py-3 pr-3">
                          <div className="space-y-1">
                            {[s.sourceLang, ...s.targetLangs].map((l) => (
                              <div key={l} className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em]">
                                <LangBadge code={l} className="h-5 min-w-7 text-[10px] text-neutral-300" />
                                {(["srt", "vtt", "txt"] as const).map((f) => (
                                  <a
                                    key={f}
                                    href={`/api/export/${s._id}?lang=${l}&format=${f}`}
                                    className="inline-flex items-center gap-1 text-neutral-400 hover:text-accent"
                                  >
                                    <Download className="h-3 w-3" /> {f}
                                  </a>
                                ))}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 text-right font-mono text-[10px] tracking-[0.2em]">
                          <DeleteButton adminKey={adminKey} id={s._id} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const endTime = (s: DashboardSession) => s.endedAt ?? s.startedAt ?? s._creationTime;

function duration(s: DashboardSession) {
  if (!s.startedAt || !s.endedAt) return "—";
  const min = Math.max(0, Math.round((s.endedAt - s.startedAt) / 60000));
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}
