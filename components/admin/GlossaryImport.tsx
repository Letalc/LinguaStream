"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { useRef, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { Check, CircleAlert, Sparkles, Upload, X } from "@/components/ui/NeonIcon";

type Candidate = {
  term: string;
  kind: "proper_noun" | "technical" | "acronym";
  translations: { es?: string; en?: string; pt?: string };
  selected: boolean;
};

const KIND_LABEL = { proper_noun: "Nombre", technical: "Técnico", acronym: "Sigla" };
const btn = "rounded-sm border border-line px-3 py-2 font-mono text-[11px] uppercase tracking-[0.2em] hover:border-accent";

/**
 * "Import from slides": upload the talk's PDF (or paste a public Google Slides link),
 * Gemini extracts a terms dictionary, the host reviews it and saves the selection.
 */
export function GlossaryImport({ adminKey, onClose }: { adminKey: string; onClose: () => void }) {
  const sessions = useQuery(api.sessions.list, {});
  const generateUploadUrl = useMutation(api.glossary.generateUploadUrl);
  const extract = useAction(api.gemini.extractGlossary);
  const addMany = useMutation(api.glossary.addMany);

  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<string>(""); // "" = whole event
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  const run = async (source: { file?: File; url?: string }) => {
    setError(null);
    setSaved(null);
    try {
      let storageId: Id<"_storage"> | undefined;
      if (source.file) {
        if (source.file.size > 20 * 1024 * 1024) throw new Error("El PDF supera los 20 MB");
        setBusy("Subiendo presentación…");
        const uploadUrl = await generateUploadUrl({ key: adminKey });
        const res = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": source.file.type || "application/pdf" },
          body: source.file,
        });
        if (!res.ok) throw new Error("No se pudo subir el archivo");
        storageId = (await res.json()).storageId;
      }
      setBusy("Gemini está leyendo las slides… (10-40 s)");
      const terms = await extract({ key: adminKey, storageId, url: source.url });
      setCandidates(terms.map((t) => ({ ...t, selected: true })));
      if (terms.length === 0) setError("No se encontraron términos en el documento.");
    } catch (e) {
      const data = (e as { data?: unknown }).data;
      setError(typeof data === "string" ? data : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!candidates) return;
    setBusy("Guardando…");
    try {
      const n = await addMany({
        key: adminKey,
        sessionId: scope ? (scope as Id<"sessions">) : undefined,
        terms: candidates
          .filter((c) => c.selected)
          .map((c) => ({
            term: c.term,
            translations: Object.fromEntries(Object.entries(c.translations).filter(([, v]) => !!v)) as Record<string, string>,
          })),
      });
      setSaved(n);
      setCandidates(null);
    } finally {
      setBusy(null);
    }
  };

  const update = (i: number, patch: Partial<Candidate>) =>
    setCandidates((cs) => cs && cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-md border border-line bg-panel p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.3em] text-accent"><Sparkles className="h-3.5 w-3.5" /> Glosario desde presentación</p>
            <p className="mt-1 text-sm text-neutral-400">
              Subí las slides de la charla y Gemini arma el diccionario de términos: nombres, productos, siglas y jerga.
            </p>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-[auto_1fr]">
          <label className="font-mono text-[10px] uppercase tracking-[0.25em] text-neutral-400 sm:pt-2.5">Aplica a</label>
          <select
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            className="rounded-sm border border-line bg-black/40 px-3 py-2 text-sm"
          >
            <option value="">Todo el evento</option>
            {sessions?.map((s) => (
              <option key={s._id} value={s._id}>Solo: {s.title} ({s.room})</option>
            ))}
          </select>
        </div>

        {!candidates && (
          <div className="mt-5 space-y-3">
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void run({ file: f });
                e.target.value = "";
              }}
            />
            <button
              disabled={!!busy}
              onClick={() => fileRef.current?.click()}
              className="w-full rounded-sm border border-dashed border-accent/50 py-8 font-mono text-xs uppercase tracking-[0.25em] text-accent hover:bg-accent/5 disabled:opacity-40"
            >
              <span className="inline-flex items-center gap-2"><Upload className="h-4 w-4" /> Subir PDF de la presentación</span>
            </button>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (url.trim()) void run({ url: url.trim() });
              }}
            >
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="…o pegá el link público de Google Slides"
                className="min-w-0 flex-1 rounded-sm border border-line bg-black/40 px-3 py-2 font-mono text-xs"
              />
              <button disabled={!!busy} className={btn}>Extraer</button>
            </form>
            <p className="text-xs text-neutral-400">PowerPoint / Keynote: exportá a PDF. Máximo 20 MB.</p>
          </div>
        )}

        {busy && <p className="mt-4 animate-pulse font-mono text-xs text-accent">{busy}</p>}
        {error && <p className="mt-4 flex items-start gap-2 text-sm text-amber-400"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}</p>}
        {saved !== null && (
          <p className="mt-4 flex items-start gap-2 text-sm text-accent">
            <Check className="mt-0.5 h-4 w-4 shrink-0" /> {saved} términos agregados. Se aplican al iniciar (o reiniciar) la transmisión de la sala.
          </p>
        )}

        {candidates && candidates.length > 0 && (
          <>
            <div className="mt-5 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.25em] text-neutral-400">
              <span>{candidates.filter((c) => c.selected).length} de {candidates.length} seleccionados</span>
              <button className="hover:text-white" onClick={() => setCandidates((cs) => cs && cs.map((c) => ({ ...c, selected: !cs.every((x) => x.selected) })))}>
                Todos / ninguno
              </button>
            </div>
            <ul className="mt-2 flex-1 space-y-1 overflow-y-auto pr-1">
              {candidates.map((c, i) => (
                <li key={c.term} className={`grid grid-cols-[auto_1fr_auto_8rem] items-center gap-3 rounded-sm px-2 py-1.5 ${c.selected ? "bg-black/30" : "opacity-40"}`}>
                  <input type="checkbox" className="accent-[#3fd8e0]" checked={c.selected} onChange={(e) => update(i, { selected: e.target.checked })} />
                  <span className="truncate text-sm">{c.term}</span>
                  <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-neutral-400">{KIND_LABEL[c.kind] ?? c.kind}</span>
                  <input
                    value={c.translations.es ?? ""}
                    onChange={(e) => update(i, { translations: { ...c.translations, es: e.target.value } })}
                    placeholder="ES"
                    title="Cómo escribirlo en los subtítulos en español"
                    className="rounded-sm border border-line bg-black/40 px-2 py-1 font-mono text-xs"
                  />
                </li>
              ))}
            </ul>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setCandidates(null)} className={btn}>Descartar</button>
              <button
                onClick={save}
                disabled={!!busy || !candidates.some((c) => c.selected)}
                className="flex-1 rounded-sm bg-accent py-2.5 font-mono text-xs font-semibold uppercase tracking-[0.3em] text-black disabled:opacity-40"
              >
                Agregar al glosario
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
