"use client";

import { useQuery } from "convex/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect } from "react";
import { api } from "@/convex/_generated/api";

/** Short link printed in the QR: /r/K7Q2 → the session's audience view. */
export default function RoomCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params);
  const room = useQuery(api.sessions.getByCode, { code });
  const router = useRouter();

  useEffect(() => {
    if (room) router.replace(`/s/${room._id}`);
  }, [room, router]);

  if (room === null) {
    return (
      <main className="mx-auto mt-24 max-w-sm px-4 text-center">
        <p className="font-mono text-4xl tracking-[0.3em]">{code.toUpperCase()}</p>
        <p className="mt-4 text-neutral-400">No encontramos una sala con ese código.</p>
        <Link href="/" className="mt-6 inline-block underline">Probar otro código</Link>
      </main>
    );
  }
  return <main className="p-8 text-center font-mono text-xs tracking-widest text-neutral-500">ENTRANDO A LA SALA…</main>;
}
