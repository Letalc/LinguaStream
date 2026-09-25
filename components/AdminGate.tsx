"use client";

import { useQuery } from "convex/react";
import { ReactNode, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAdminKey } from "@/lib/useAdminKey";
import { Dot } from "@/components/ui/Dot";

export type Role = "admin" | "demo";

/** Renders children only once a valid admin password (or the demo key) is stored locally. */
export function AdminGate({
  children,
}: {
  children: (key: string, logout: () => void, role: Role) => ReactNode;
}) {
  const { key, setKey, loaded } = useAdminKey();
  const role = useQuery(api.sessions.checkKey, key ? { key } : "skip");
  const demoAvailable = useQuery(api.sessions.demoAvailable);
  const [draft, setDraft] = useState("");
  const [tried, setTried] = useState(false);

  if (!loaded || (key && role === undefined)) {
    return <div className="p-8 font-mono text-xs tracking-widest text-neutral-400">CARGANDO…</div>;
  }
  if (key && role) return <>{children(key, () => setKey(null), role)}</>;

  return (
    <div className="mx-auto mt-24 w-full max-w-sm px-4">
      <p className="flex items-center gap-2 font-mono text-[11px] tracking-[0.3em] text-accent"><Dot className="bg-accent" pulse /> PRODUCTION COMMAND</p>
      <h1 className="mt-2 text-2xl font-semibold">Acceso Host</h1>
      <p className="mt-1 text-sm text-neutral-400">Creá salas, transmití el audio y compartí el QR con la audiencia.</p>

      {demoAvailable && (
        <button
          onClick={() => {
            setTried(true);
            setKey("demo");
          }}
          className="mt-6 w-full rounded-lg bg-cyan-300 py-3 font-mono text-sm font-semibold tracking-widest text-black hover:bg-cyan-200"
        >
          ENTRAR COMO DEMO →
        </button>
      )}
      {demoAvailable && (
        <p className="mt-2 text-xs text-neutral-400">
          Modo demo: acceso directo para probar la plataforma.
        </p>
      )}

      <form
        className="mt-6 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setTried(true);
          setKey(draft.trim());
        }}
      >
        <input
          type="password"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm"
          placeholder="Contraseña del evento"
        />
        <button className="rounded-lg border border-neutral-700 px-4 py-2 text-sm">Entrar</button>
      </form>
      {tried && key && role === null && <p className="mt-3 text-sm text-red-400">Acceso inválido.</p>}
    </div>
  );
}
