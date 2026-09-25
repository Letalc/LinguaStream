"use client";

import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { AdminGate } from "@/components/AdminGate";
import { ShareDialog } from "@/components/ShareDialog";
import { LANGS, langLabel, type Lang } from "@/lib/langs";

export default function AdminPage() {
  return <AdminGate>{(key, logout) => <Dashboard adminKey={key} logout={logout} />}</AdminGate>;
}

const STATUS_DOT: Record<string, string> = {
  idle: "bg-neutral-600",
  live: "bg-emerald-500",
  reconnecting: "bg-amber-500 animate-pulse",
  paused: "bg-sky-500",
  error: "bg-red-500",
  ended: "bg-neutral-600",
};

function Dashboard({ adminKey, logout }: { adminKey: string; logout: () => void }) {
  const sessions = useQuery(api.sessions.dashboard);
  // Queries must not read the clock, so the page ticks `now` itself.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);

  const live = sessions?.filter((s) => s.status === "live").length ?? 0;
  const problems = sessions?.filter((s) => s.status === "error" || s.status === "reconnecting").length ?? 0;

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Panel de producción</h1>
          <p className="text-sm text-neutral-400">
            {sessions?.length ?? 0} sesiones · <span className="text-emerald-400">{live} en vivo</span>
            {problems > 0 && <span className="text-amber-400"> · {problems} con problemas</span>}
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/" className="text-neutral-400 hover:text-white">Vista pública</Link>
          <button onClick={logout} className="text-neutral-400 hover:text-white">Salir</button>
        </div>
      </header>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {sessions?.map((s) => {
          const stale =
            (s.status === "live" || s.status === "reconnecting") &&
            s.stats !== null &&
            now - s.stats.lastHeartbeatAt > 15_000;
          return (
            <article key={s._id} className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate font-medium">{s.title}</h2>
                  <p className="truncate text-xs text-neutral-400">
                    {s.room} · {langLabel(s.sourceLang)}
                    {s.targetLangs.length > 0 && ` → ${s.targetLangs.map((l) => l.toUpperCase()).join(" ")}`}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 text-xs">
                  <span className={`h-2 w-2 rounded-full ${stale ? "bg-red-500" : STATUS_DOT[s.status]}`} />
                  {stale ? "sin señal" : s.status}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <Stat label="Latencia" value={s.stats?.avgLatencyMs != null ? `${(s.stats.avgLatencyMs / 1000).toFixed(1)}s` : "—"} />
                <Stat label="Líneas" value={String(s.stats?.segmentCount ?? 0)} />
                <Stat
                  label="Errores"
                  value={`${s.stats?.errorCount ?? 0}${s.stats?.reconnectCount ? ` · ${s.stats.reconnectCount}↻` : ""}`}
                  warn={(s.stats?.errorCount ?? 0) > 0}
                />
              </dl>
              {s.stats?.lastError && (
                <p className="mt-2 truncate text-xs text-amber-400" title={s.stats.lastError}>
                  ⚠ {s.stats.lastError}
                </p>
              )}
              <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                <Link className="text-emerald-400 underline" href={`/console/${s._id}`}>Consola</Link>
                <Link className="underline" href={`/s/${s._id}`} target="_blank">Audiencia</Link>
                <Link className="underline" href={`/overlay/${s._id}?lang=${s.targetLangs[0] ?? s.sourceLang}`} target="_blank">Overlay</Link>
                <a className="underline" href={`/api/export/${s._id}?lang=${s.sourceLang}&format=srt`}>SRT</a>
                {s.code && <ShareButton id={s._id} code={s.code} title={s.title} />}
                <DeleteButton adminKey={adminKey} id={s._id} />
              </div>
            </article>
          );
        })}
        <NewSession adminKey={adminKey} />
      </div>

      <Glossary adminKey={adminKey} />
    </main>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-neutral-900 py-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className={`mt-0.5 font-mono text-sm ${warn ? "text-amber-400" : ""}`}>{value}</dd>
    </div>
  );
}

function ShareButton({ id, code, title }: { id: string; code: string; title: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="text-cyan-300 underline" onClick={() => setOpen(true)}>QR {code}</button>
      {open && <ShareDialog sessionId={id} code={code} title={title} onClose={() => setOpen(false)} />}
    </>
  );
}

function DeleteButton({ adminKey, id }: { adminKey: string; id: Id<"sessions"> }) {
  const remove = useMutation(api.sessions.remove);
  const [armed, setArmed] = useState(false);
  return (
    <button
      className={`ml-auto ${armed ? "text-red-400" : "text-neutral-500"}`}
      onClick={() => (armed ? remove({ key: adminKey, sessionId: id }) : setArmed(true))}
      onBlur={() => setArmed(false)}
    >
      {armed ? "¿Borrar?" : "Borrar"}
    </button>
  );
}

function NewSession({ adminKey }: { adminKey: string }) {
  const create = useMutation(api.sessions.create);
  const [title, setTitle] = useState("");
  const [room, setRoom] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [sourceLang, setSourceLang] = useState<Lang>("en");
  const [targets, setTargets] = useState<Lang[]>(["es"]);

  return (
    <form
      className="rounded-2xl border border-dashed border-neutral-700 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || !room.trim()) return;
        await create({ key: adminKey, title, room, speaker: speaker || undefined, sourceLang, targetLangs: targets });
        setTitle("");
        setSpeaker("");
      }}
    >
      <h2 className="font-medium">Nueva sesión</h2>
      <div className="mt-3 space-y-2 text-sm">
        <input className="w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" placeholder="Título de la charla" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="flex gap-2">
          <input className="w-1/2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" placeholder="Sala" value={room} onChange={(e) => setRoom(e.target.value)} />
          <input className="w-1/2 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" placeholder="Orador (opcional)" value={speaker} onChange={(e) => setSpeaker(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <span className="text-neutral-400">Habla en</span>
          <select className="rounded-lg border border-neutral-700 bg-neutral-900 px-2 py-1.5" value={sourceLang} onChange={(e) => setSourceLang(e.target.value as Lang)}>
            {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-neutral-400">Traducir a</span>
          {LANGS.filter((l) => l.code !== sourceLang).map((l) => (
            <label key={l.code} className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={targets.includes(l.code)}
                onChange={(e) => setTargets((t) => (e.target.checked ? [...t, l.code] : t.filter((x) => x !== l.code)))}
              />
              {l.label}
            </label>
          ))}
        </div>
      </div>
      <button className="mt-3 w-full rounded-lg bg-emerald-500 py-2 font-medium text-black">Crear sesión</button>
    </form>
  );
}

function Glossary({ adminKey }: { adminKey: string }) {
  const terms = useQuery(api.glossary.list);
  const add = useMutation(api.glossary.add);
  const remove = useMutation(api.glossary.remove);
  const [term, setTerm] = useState("");
  const [es, setEs] = useState("");

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Glosario del evento</h2>
      <p className="text-sm text-neutral-400">
        Términos técnicos y nombres propios. Mejoran el reconocimiento de voz y fuerzan la traducción (se aplica a sesiones nuevas o reiniciadas).
      </p>
      <form
        className="mt-3 flex flex-wrap gap-2 text-sm"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!term.trim()) return;
          await add({ key: adminKey, term, translations: es.trim() ? { es: es.trim() } : undefined });
          setTerm("");
          setEs("");
        }}
      >
        <input className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" placeholder="Término (ej. Kubernetes)" value={term} onChange={(e) => setTerm(e.target.value)} />
        <input className="rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2" placeholder="Traducción forzada ES (opcional)" value={es} onChange={(e) => setEs(e.target.value)} />
        <button className="rounded-lg border border-neutral-700 px-4 py-2">Agregar</button>
      </form>
      <ul className="mt-3 flex flex-wrap gap-2 text-sm">
        {terms?.map((t) => (
          <li key={t._id} className="flex items-center gap-2 rounded-full border border-neutral-800 px-3 py-1">
            {t.term}
            {t.translations?.es && <span className="text-neutral-500">→ {t.translations.es}</span>}
            <button className="text-neutral-500 hover:text-red-400" onClick={() => remove({ key: adminKey, id: t._id })}>×</button>
          </li>
        ))}
      </ul>
    </section>
  );
}
