"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/convex/_generated/api";
import { AdminGate, type Role } from "@/components/AdminGate";
import { SessionCard } from "@/components/admin/SessionCard";
import { AlertsFeed, AlertToasts } from "@/components/admin/Alerts";
import { GlossaryPanel, NewSessionPanel } from "@/components/admin/SidePanels";
import { BUCKETS, bucketOf, type Bucket } from "@/components/admin/health";
import { Bell, BellOff, ExternalLink, LogOut } from "lucide-react";
import { Dot } from "@/components/ui/Dot";

export default function AdminPage() {
  return (
    <AdminGate>
      {(key, logout, role) => <CommandCenter adminKey={key} logout={logout} role={role} />}
    </AdminGate>
  );
}

function CommandCenter({ adminKey, logout, role }: { adminKey: string; logout: () => void; role: Role }) {
  const sessions = useQuery(api.sessions.dashboard);
  const [filter, setFilter] = useState<Bucket | "all">("all");
  const [sound, setSound] = useState(true);
  // Queries must not read the clock, so the page ticks `now` itself (drives "no signal").
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);

  const grouped = useMemo(() => {
    const g: Record<Bucket, NonNullable<typeof sessions>> = { problem: [], live: [], idle: [], ended: [] };
    for (const s of sessions ?? []) g[bucketOf(s, now)].push(s);
    return g;
  }, [sessions, now]);

  const liveCount = grouped.live.length;
  const running = [...grouped.live, ...grouped.problem];
  const latencies = running.map((s) => s.stats?.avgLatencyMs).filter((x): x is number => typeof x === "number");
  const globalLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;
  const visible = BUCKETS.filter((b) => filter === "all" || filter === b.id);

  return (
    <div className="flex min-h-dvh flex-col">
      <AlertToasts sessions={sessions} now={now} sound={sound} />

      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-line px-6 py-5 lg:px-10">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-bold uppercase tracking-tight">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-accent" />
            Production Command
            <span className="font-mono text-sm font-normal text-accent/70">v1.0</span>
            {role === "demo" && (
              <span className="rounded-sm border border-amber-500/40 px-2 py-0.5 font-mono text-[10px] tracking-[0.2em] text-amber-400">
                DEMO
              </span>
            )}
          </h1>
          <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.3em] text-neutral-500">
            {sessions?.length ?? 0} sesiones // <span className="text-accent">{liveCount} en vivo</span>
            {grouped.problem.length > 0 && <span className="text-red-400"> // {grouped.problem.length} con problemas</span>}
          </p>
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-neutral-500">Latencia global</p>
            <p className="font-mono text-sm text-accent">
              {globalLatency !== null ? `prom ${(globalLatency / 1000).toFixed(1)}s` : "—"}
            </p>
          </div>
          <button
            onClick={() => setSound((x) => !x)}
            className="font-mono text-[11px] uppercase tracking-[0.25em] text-neutral-500 hover:text-white"
            title="Sonido de alertas" aria-label="Sonido de alertas"
          >
            {sound ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </button>
          <Link
            href="/"
            target="_blank"
            className="border border-line px-4 py-2 font-mono text-[11px] uppercase tracking-[0.3em] hover:border-neutral-500"
          >
            <span className="inline-flex items-center gap-2">Vista pública <ExternalLink className="h-3 w-3" /></span>
          </Link>
          <button onClick={logout} className="font-mono text-[11px] uppercase tracking-[0.3em] text-red-400 hover:text-red-300">
            <span className="inline-flex items-center gap-2"><LogOut className="h-3.5 w-3.5" /> Salir</span>
          </button>
        </div>
      </header>

      {/* Funnel filter */}
      <nav className="flex flex-wrap gap-2 px-6 pt-6 lg:px-10">
        <FunnelTab active={filter === "all"} onClick={() => setFilter("all")} label="Todas" count={sessions?.length ?? 0} />
        {BUCKETS.map((b) => (
          <FunnelTab
            key={b.id}
            active={filter === b.id}
            onClick={() => setFilter(b.id)}
            label={b.label}
            count={grouped[b.id].length}
            tone={b.id === "problem" && grouped.problem.length > 0 ? "danger" : b.id === "live" ? "live" : undefined}
          />
        ))}
      </nav>

      <div className="grid flex-1 gap-6 px-6 py-6 lg:grid-cols-[1fr_380px] lg:px-10">
        <main className="space-y-8">
          {sessions === undefined && <p className="font-mono text-xs tracking-widest text-neutral-500">CARGANDO…</p>}
          {visible.map((b) =>
            grouped[b.id].length === 0 ? null : (
              <section key={b.id}>
                <h2
                  className={`mb-3 font-mono text-[11px] uppercase tracking-[0.3em] ${
                    b.id === "problem" ? "text-red-400" : b.id === "live" ? "text-accent" : "text-neutral-500"
                  }`}
                >
                  {b.label} · {grouped[b.id].length}
                </h2>
                <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
                  {grouped[b.id].map((s) => (
                    <SessionCard key={s._id} s={s} now={now} adminKey={adminKey} />
                  ))}
                </div>
              </section>
            ),
          )}
          {sessions && sessions.length === 0 && (
            <p className="text-neutral-500">No hay sesiones. Creá la primera desde el panel de la derecha →</p>
          )}
        </main>

        <aside className="space-y-6">
          <NewSessionPanel adminKey={adminKey} />
          <AlertsFeed />
          <GlossaryPanel adminKey={adminKey} />
        </aside>
      </div>

      <footer className="flex items-center justify-between border-t border-line px-6 py-3 font-mono text-[10px] uppercase tracking-[0.3em] lg:px-10">
        <span className="text-neutral-600">Nodos activos: {running.length}</span>
        {grouped.problem.length === 0 ? (
          <span className="flex items-center gap-2 text-accent"><Dot className="bg-accent" /> Todos los sistemas operativos</span>
        ) : (
          <span className="flex items-center gap-2 text-red-400"><Dot className="bg-red-500" pulse /> {grouped.problem.length} sala(s) con problemas</span>
        )}
      </footer>
    </div>
  );
}

function FunnelTab({
  active,
  onClick,
  label,
  count,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  tone?: "danger" | "live";
}) {
  const toneCls = tone === "danger" ? "text-red-400" : tone === "live" ? "text-accent" : "text-neutral-300";
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.25em] ${
        active ? "border-accent bg-accent/10" : "border-line hover:border-neutral-600"
      }`}
    >
      <span className={toneCls}>{label}</span>
      <span className="rounded-sm bg-black/50 px-1.5 text-neutral-400">{count}</span>
    </button>
  );
}
