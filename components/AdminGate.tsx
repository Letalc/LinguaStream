"use client";

import { useQuery } from "convex/react";
import { ReactNode, useState } from "react";
import { api } from "@/convex/_generated/api";
import { useAdminKey } from "@/lib/useAdminKey";

/** Renders children only once a valid admin password is stored in this browser. */
export function AdminGate({ children }: { children: (key: string, logout: () => void) => ReactNode }) {
  const { key, setKey, loaded } = useAdminKey();
  const valid = useQuery(api.sessions.checkKey, key ? { key } : "skip");
  const [draft, setDraft] = useState("");
  const [tried, setTried] = useState(false);

  if (!loaded || (key && valid === undefined)) {
    return <div className="p-8 text-neutral-400">Cargando…</div>;
  }
  if (key && valid) return <>{children(key, () => setKey(null))}</>;

  return (
    <div className="mx-auto mt-24 w-full max-w-sm px-4">
      <h1 className="text-xl font-semibold">Acceso de producción</h1>
      <p className="mt-1 text-sm text-neutral-400">Ingresá la contraseña del evento.</p>
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
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="flex-1 rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2"
          placeholder="Contraseña"
        />
        <button className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-black">Entrar</button>
      </form>
      {tried && key && valid === false && (
        <p className="mt-3 text-sm text-red-400">Contraseña incorrecta.</p>
      )}
    </div>
  );
}
