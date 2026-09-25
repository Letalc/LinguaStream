"use client";

import Link from "next/link";
import { useState } from "react";
import { QrCode } from "./QrCode";
import { roomUrl } from "@/lib/publicUrl";
import { Check, Copy, Presentation, QrCode as QrCodeIcon, X } from "lucide-react";

/** Host tool: room code + QR + link to hand to the audience. */
export function ShareDialog({
  sessionId,
  code,
  title,
  onClose,
}: {
  sessionId: string;
  code: string;
  title: string;
  onClose: () => void;
}) {
  const url = roomUrl(code);
  const [copied, setCopied] = useState(false);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-[#0b0d10] p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.3em] text-accent"><QrCodeIcon className="h-3.5 w-3.5" /> COMPARTIR SALA</p>
            <h2 className="mt-1 truncate font-medium">{title}</h2>
          </div>
          <button onClick={onClose} className="text-neutral-500 hover:text-white" aria-label="Cerrar"><X className="h-5 w-5" /></button>
        </div>
        <QrCode value={url} className="mx-auto mt-5 aspect-square w-60" />
        <p className="mt-4 text-center font-mono text-4xl font-semibold tracking-[0.3em]">{code}</p>
        <div className="mt-4 flex gap-2">
          <input readOnly value={url} className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs" />
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {}
            }}
            className="rounded-lg border border-neutral-700 px-3 text-xs" aria-label="Copiar link"
          >
            {copied ? <Check className="h-4 w-4 text-accent" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
        <Link
          href={`/share/${sessionId}`}
          target="_blank"
          className="mt-3 block rounded-lg bg-accent py-2.5 text-center font-mono text-sm font-semibold tracking-widest text-black"
        >
          <span className="inline-flex items-center gap-2"><Presentation className="h-4 w-4" /> PROYECTAR EN PANTALLA</span>
        </Link>
        <Link
          href={`/present/${sessionId}`}
          target="_blank"
          className="mt-2 block rounded-lg border border-cyan-300/50 py-2.5 text-center font-mono text-xs font-semibold tracking-widest text-cyan-200"
        >
          PRESENTACIÓN + CC
        </Link>
        <Link
          href={`/overlay/${sessionId}?lang=es&size=42&lines=2&bg=1`}
          target="_blank"
          className="mt-2 block py-2 text-center font-mono text-[11px] tracking-widest text-neutral-400 hover:text-white"
        >
          OVERLAY TRANSPARENTE PARA OBS / VMIX
        </Link>
      </div>
    </div>
  );
}
