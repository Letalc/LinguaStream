"use client";

import { Check, Ear } from "@/components/ui/NeonIcon";
import { useState } from "react";
import { LangBadge } from "@/components/ui/LangBadge";
import { LANGS, type Lang } from "@/lib/langs";

export type ViewMode = "standard" | "accessible";
export type JoinChoice = { lang: Lang; mode: ViewMode };

/**
 * First thing a viewer sees after scanning the room QR: pick the subtitle language,
 * or the accessible mode for deaf / hard-of-hearing people. Confirming is also the
 * user gesture browsers require before allowing speech and vibration.
 */
export function JoinDialog({
  title,
  subtitle,
  available,
  sourceLang,
  initial,
  onConfirm,
  onCancel,
}: {
  title: string;
  subtitle: string;
  available: Lang[];
  sourceLang: Lang;
  initial: JoinChoice;
  onConfirm: (choice: JoinChoice) => void;
  onCancel?: () => void;
}) {
  const [mode, setMode] = useState<ViewMode>(initial.mode);
  const [lang, setLang] = useState<Lang>(available.includes(initial.lang) ? initial.lang : available[0]);
  const langs = LANGS.filter((l) => available.includes(l.code));

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-md sm:items-center" role="dialog" aria-modal="true" aria-labelledby="join-title">
      <div className="w-full max-w-md rounded-t-2xl border border-line bg-panel p-6 shadow-2xl sm:rounded-2xl">
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-accent">Subtítulos en vivo</p>
        <h2 id="join-title" className="mt-2 text-xl font-semibold leading-tight">{title}</h2>
        <p className="mt-1 text-sm text-neutral-400">{subtitle}</p>

        <p className="mt-6 text-sm text-neutral-300">¿Cómo querés seguir la charla?</p>
        <div className="mt-3 space-y-2">
          {langs.map((l) => {
            const active = mode === "standard" && lang === l.code;
            return (
              <button
                key={l.code}
                onClick={() => {
                  setMode("standard");
                  setLang(l.code);
                }}
                aria-pressed={active}
                className={`flex w-full items-center gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors ${
                  active ? "border-accent bg-accent/10" : "border-line bg-black/30 hover:border-neutral-600"
                }`}
              >
                <LangBadge code={l.code} className={active ? "text-accent" : "text-neutral-300"} />
                <span className="flex-1 text-base">{l.label}</span>
                {l.code === sourceLang && <span className="text-xs text-neutral-500">idioma original</span>}
                {active && <Check className="h-4 w-4 text-accent" />}
              </button>
            );
          })}

          <button
            onClick={() => setMode("accessible")}
            aria-pressed={mode === "accessible"}
            className={`flex w-full items-start gap-4 rounded-xl border px-4 py-3.5 text-left transition-colors ${
              mode === "accessible" ? "border-yellow-300 bg-yellow-300/10" : "border-line bg-black/30 hover:border-neutral-600"
            }`}
          >
            <span className={`flex h-6 min-w-8 items-center justify-center ${mode === "accessible" ? "text-yellow-300" : "text-neutral-300"}`}>
              <Ear className="h-5 w-5" />
            </span>
            <span className="flex-1">
              <span className="block text-base">Accesible</span>
              <span className="block text-xs text-neutral-400">
                Para personas sordas o con hipoacusia: letra grande, alto contraste, indicador de voz e intérprete de señas si está disponible.
              </span>
            </span>
            {mode === "accessible" && <Check className="mt-1 h-4 w-4 text-yellow-300" />}
          </button>

          {mode === "accessible" && langs.length > 1 && (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-black/30 px-4 py-3">
              <span className="text-xs text-neutral-400">Leer en</span>
              {langs.map((l) => (
                <button
                  key={l.code}
                  onClick={() => setLang(l.code)}
                  aria-pressed={lang === l.code}
                  className={`rounded-md border px-3 py-1 text-sm ${lang === l.code ? "border-yellow-300 text-yellow-300" : "border-line text-neutral-300"}`}
                >
                  {l.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => onConfirm({ lang, mode })}
          className="mt-6 w-full rounded-xl bg-accent py-3.5 font-mono text-sm font-semibold uppercase tracking-[0.25em] text-black hover:brightness-110"
        >
          Confirmar y entrar
        </button>
        {onCancel && (
          <button onClick={onCancel} className="mt-2 w-full py-2 text-sm text-neutral-500 hover:text-white">
            Cancelar
          </button>
        )}
      </div>
    </div>
  );
}
