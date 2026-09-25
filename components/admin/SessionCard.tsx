"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { ShareDialog } from "@/components/ShareDialog";
import { langLabel } from "@/lib/langs";
import { statusChip, type DashboardSession } from "./health";

const CHIP_TONE = {
  live: "border-accent/40 text-accent",
  warn: "border-amber-500/40 text-amber-400",
  danger: "border-danger/50 bg-danger/10 text-red-400",
  info: "border-sky-500/40 text-sky-400",
  muted: "border-line text-neutral-500",
};

export function SessionCard({ s, now, adminKey }: { s: DashboardSession; now: number; adminKey: string }) {
  const chip = statusChip(s, now);
  const danger = chip.tone === "danger";
  const running = s.status === "live" || s.status === "reconnecting" || s.status === "paused";
  const [sharing, setSharing] = useState(false);
  const feedLang = s.targetLangs[0] ?? s.sourceLang;

  return (
    <article
      className={`flex flex-col rounded-md border bg-panel p-5 transition-colors ${
        danger ? "border-danger/70 shadow-[inset_3px_0_0_0_var(--color-danger)]" : "border-line"
      }`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate font-medium">{s.title}</h3>
          <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-[0.2em] text-neutral-500">
            {s.room} · {langLabel(s.sourceLang)} → {s.targetLangs.map((l) => l.toUpperCase()).join(" ") || "—"}
          </p>
        </div>
        <span
          className={`flex shrink-0 items-center gap-1.5 rounded-sm border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.2em] ${CHIP_TONE[chip.tone]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full bg-current ${chip.tone === "live" || danger ? "animate-pulse" : ""}`} />
          {chip.label}
        </span>
      </header>

      <dl className="mt-4 grid grid-cols-3 gap-2">
        <Metric
          label="Latencia"
          value={s.stats?.avgLatencyMs != null ? `${(s.stats.avgLatencyMs / 1000).toFixed(1)}s` : "—"}
          warn={(s.stats?.avgLatencyMs ?? 0) > 4000}
        />
        <Metric label="Líneas" value={String(s.stats?.segmentCount ?? 0)} />
        <Metric
          label="Errores"
          value={`${s.stats?.errorCount ?? 0}${s.stats?.reconnectCount ? ` · ${s.stats.reconnectCount}↻` : ""}`}
          warn={(s.stats?.errorCount ?? 0) > 0}
        />
      </dl>

      {running && <LastLine sessionId={s._id} lang={feedLang} waiting={danger} />}
      {s.stats?.lastError && (
        <p
          className="mt-3 truncate rounded-sm border border-line bg-black/30 px-3 py-2 font-mono text-[11px] text-amber-400/90"
          title={s.stats.lastError}
        >
          [!] {s.stats.lastError}
        </p>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4 font-mono text-[10px] uppercase tracking-[0.2em]">
        <Link className="text-accent hover:underline" href={`/console/${s._id}`}>Consola</Link>
        <Link className="text-neutral-400 hover:text-white" href={`/s/${s._id}`} target="_blank">Audiencia</Link>
        <Link className="text-neutral-400 hover:text-white" href={`/overlay/${s._id}?lang=${feedLang}`} target="_blank">Overlay</Link>
        <a className="text-neutral-400 hover:text-white" href={`/api/export/${s._id}?lang=${s.sourceLang}&format=srt`}>SRT</a>
        {s.code && (
          <button className="text-accent hover:underline" onClick={() => setSharing(true)}>QR · {s.code}</button>
        )}
        <DeleteButton adminKey={adminKey} id={s._id} />
      </footer>
      {sharing && s.code && (
        <ShareDialog sessionId={s._id} code={s.code} title={s.title} onClose={() => setSharing(false)} />
      )}
    </article>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-sm border border-line bg-black/30 px-3 py-2">
      <dt className="font-mono text-[9px] uppercase tracking-[0.25em] text-neutral-500">{label}</dt>
      <dd className={`mt-1 font-mono text-base ${warn ? "text-amber-400" : "text-neutral-100"}`}>{value}</dd>
    </div>
  );
}

/** Live peek at what the audience is reading right now. */
function LastLine({ sessionId, lang, waiting }: { sessionId: DashboardSession["_id"]; lang: DashboardSession["sourceLang"]; waiting: boolean }) {
  const feed = useQuery(api.segments.feed, { sessionId, lang, limit: 1 });
  const text = feed?.partial || feed?.lines[0]?.text;
  return (
    <p className="mt-3 truncate rounded-sm border border-dashed border-line px-3 py-2 text-center font-mono text-[11px] tracking-wide text-neutral-400">
      {waiting ? "ESPERANDO SEÑAL…" : text ? `“${text}”` : "SIN SUBTÍTULOS TODAVÍA"}
    </p>
  );
}

function DeleteButton({ adminKey, id }: { adminKey: string; id: DashboardSession["_id"] }) {
  const remove = useMutation(api.sessions.remove);
  const [armed, setArmed] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <button
      className={`ml-auto uppercase ${armed ? "text-red-400" : "text-neutral-600 hover:text-neutral-400"}`}
      title={err ?? undefined}
      onClick={() => {
        if (!armed) return setArmed(true);
        remove({ key: adminKey, sessionId: id }).catch((e) => setErr(String(e?.data ?? e)));
      }}
      onBlur={() => setArmed(false)}
    >
      {err ? "No permitido" : armed ? "¿Borrar?" : "Borrar"}
    </button>
  );
}
