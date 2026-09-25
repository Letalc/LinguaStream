"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { LANGS, type Lang } from "@/lib/langs";
import { fromLocalInput } from "@/lib/startTime";
import { GlossaryImport } from "./GlossaryImport";
import { Plus } from "lucide-react";
import { Sparkles, X } from "@/components/ui/NeonIcon";

const input =
  "w-full rounded-sm border border-line bg-black/40 px-3 py-2.5 font-mono text-sm placeholder:text-neutral-500 focus:border-accent focus:outline-none";
const label = "mb-1.5 block font-mono text-[10px] uppercase tracking-[0.25em] text-neutral-400";

export function NewSessionPanel({ adminKey }: { adminKey: string }) {
  const create = useMutation(api.sessions.create);
  const [title, setTitle] = useState("");
  const [room, setRoom] = useState("");
  const [speaker, setSpeaker] = useState("");
  const [startsAt, setStartsAt] = useState(""); // optional, datetime-local value
  const [sourceLang, setSourceLang] = useState<Lang>("en");
  const [targets, setTargets] = useState<Lang[]>(["es"]);
  const [busy, setBusy] = useState(false);
  const validTargets = targets.filter((t) => t !== sourceLang);

  return (
    <form
      className="rounded-md border border-line bg-panel p-5"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim() || !room.trim() || validTargets.length === 0) return;
        setBusy(true);
        try {
          await create({ key: adminKey, title, room, speaker: speaker || undefined, sourceLang, targetLangs: validTargets, scheduledAt: fromLocalInput(startsAt) });
          setTitle("");
          setSpeaker("");
          setStartsAt("");
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em]">
        <span className="h-2 w-2 bg-accent" /> Nueva sesión
      </h2>
      <div className="mt-5 space-y-4">
        <div>
          <label className={label}>Título de la charla</label>
          <input className={input} placeholder="Ej. Keynote de apertura…" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={label}>Sala</label>
            <input className={input} placeholder="Sala 1" value={room} onChange={(e) => setRoom(e.target.value)} />
          </div>
          <div>
            <label className={label}>Orador</label>
            <input className={input} placeholder="Opcional" value={speaker} onChange={(e) => setSpeaker(e.target.value)} />
          </div>
        </div>
        <div>
          <label className={label}>Hora de inicio · opcional</label>
          <input type="datetime-local" className={`${input} [color-scheme:dark]`} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </div>
        <div>
          <label className={label}>Habla en · idioma del orador</label>
          <select className={input} value={sourceLang} onChange={(e) => setSourceLang(e.target.value as Lang)}>
            {LANGS.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
        <div>
          <span className={label}>Traducir a</span>
          <div className="flex flex-wrap gap-4">
            {LANGS.filter((l) => l.code !== sourceLang).map((l) => (
              <label key={l.code} className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-neutral-300">
                <input
                  type="checkbox"
                  className="accent-[#3fd8e0]"
                  checked={targets.includes(l.code)}
                  onChange={(e) => setTargets((t) => (e.target.checked ? [...t, l.code] : t.filter((x) => x !== l.code)))}
                />
                {l.label}
              </label>
            ))}
          </div>
        </div>
      </div>
      <button
        disabled={busy || validTargets.length === 0}
        className="mt-6 w-full rounded-sm bg-accent py-3 font-mono text-sm font-semibold uppercase tracking-[0.3em] text-black hover:brightness-110 disabled:opacity-40"
      >
        {busy ? "Creando…" : "Crear sesión"}
      </button>
    </form>
  );
}

export function GlossaryPanel({ adminKey }: { adminKey: string }) {
  const terms = useQuery(api.glossary.list, { key: adminKey });
  const add = useMutation(api.glossary.add);
  const remove = useMutation(api.glossary.remove);
  const [term, setTerm] = useState("");
  const [es, setEs] = useState("");
  const [importing, setImporting] = useState(false);

  return (
    <section className="rounded-md border border-line bg-panel p-5">
      {importing && <GlossaryImport adminKey={adminKey} onClose={() => setImporting(false)} />}
      <h2 className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em]">
        <span className="h-2 w-2 border border-neutral-400" /> Glosario del evento
      </h2>
      <p className="mt-3 text-xs leading-relaxed text-neutral-400">
        Términos técnicos y nombres propios. Mejoran el reconocimiento de voz y fuerzan la traducción en sesiones nuevas o reiniciadas.
      </p>
      <button
        onClick={() => setImporting(true)}
        className="mt-4 w-full rounded-sm border border-accent/50 py-2.5 font-mono text-[11px] uppercase tracking-[0.25em] text-accent hover:bg-accent/5"
      >
        <span className="inline-flex items-center gap-2"><Sparkles className="h-3.5 w-3.5" /> Extraer de la presentación (IA)</span>
      </button>
      <form
        className="mt-4 flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!term.trim()) return;
          await add({ key: adminKey, term, translations: es.trim() ? { es: es.trim() } : undefined });
          setTerm("");
          setEs("");
        }}
      >
        <input className={input} placeholder="Término (ej. Kubernetes)" value={term} onChange={(e) => setTerm(e.target.value)} />
        <input className={`${input} max-w-28`} placeholder="Trad. ES" value={es} onChange={(e) => setEs(e.target.value)} />
        <button className="rounded-sm border border-line px-3 font-mono text-accent hover:border-accent" aria-label="Agregar término"><Plus className="h-4 w-4" /></button>
      </form>
      <ul className="mt-4 flex flex-wrap gap-2">
        {terms?.map((t) => (
          <li key={t._id} className="flex items-center gap-2 rounded-sm border border-accent/30 px-2 py-1 font-mono text-[11px] text-accent">
            {t.term}
            {t.translations?.es && <span className="text-neutral-400">→ {t.translations.es}</span>}
            {t.sessionTitle && <span className="max-w-24 truncate text-neutral-400" title={t.sessionTitle}>@{t.sessionTitle}</span>}
            <button className="text-neutral-400 hover:text-red-400" onClick={() => remove({ key: adminKey, id: t._id })} aria-label={`Quitar ${t.term}`}>
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
