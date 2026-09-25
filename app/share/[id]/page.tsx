"use client";

import { useQuery } from "convex/react";
import { use } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";
import { QrCode } from "@/components/QrCode";
import { publicBaseUrl, roomUrl } from "@/lib/publicUrl";
import { langLabel } from "@/lib/langs";
import { Dot } from "@/components/ui/Dot";

/** Full-screen slide for the room projector: "Scan for live subtitles". */
export default function ProjectorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const session = useQuery(api.sessions.get, { sessionId: id as Id<"sessions"> });
  if (!session) return <main className="p-8 text-neutral-400">{session === null ? "Sesión no encontrada." : "Cargando…"}</main>;
  if (!session.code) return <main className="p-8">Esta sesión no tiene código de sala.</main>;

  const langs = [session.sourceLang, ...session.targetLangs].map(langLabel).join(" · ");
  const host = publicBaseUrl().replace(/^https?:\/\//, "");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-8 bg-black p-8 text-center lg:flex-row lg:gap-20">
      <QrCode value={roomUrl(session.code)} className="aspect-square w-[min(70vw,60vh)]" />
      <div className="max-w-xl">
        <p className="flex items-center gap-3 font-mono text-sm tracking-[0.4em] text-accent"><Dot className="h-2.5 w-2.5 bg-accent" pulse /> SUBTÍTULOS EN VIVO</p>
        <h1 className="mt-4 text-4xl font-semibold leading-tight lg:text-5xl">{session.title}</h1>
        <p className="mt-3 text-xl text-neutral-400">{langs}</p>
        <p className="mt-10 text-lg text-neutral-400">Escaneá el QR o entrá a</p>
        <p className="mt-1 font-mono text-2xl">{host}</p>
        <p className="mt-2 text-lg text-neutral-400">con el código</p>
        <p className="mt-1 font-mono text-7xl font-bold tracking-[0.3em] text-cyan-300">{session.code}</p>
      </div>
    </main>
  );
}
