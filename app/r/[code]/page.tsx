import { fetchQuery } from "convex/nextjs";
import Link from "next/link";
import { redirect } from "next/navigation";
import { api } from "@/convex/_generated/api";

/**
 * Short link printed in the QR: /r/K7Q2 → the session's audience view.
 * Resolved on the server so the phone gets a plain HTTP redirect instead of loading
 * the whole app, opening a websocket and only then navigating.
 */
export default async function RoomCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const room = await fetchQuery(api.sessions.getByCode, { code }).catch(() => null);
  if (room) redirect(`/s/${room._id}`);

  return (
    <main className="mx-auto mt-24 max-w-sm px-4 text-center">
      <p className="font-mono text-4xl tracking-[0.3em]">{code.toUpperCase()}</p>
      <p className="mt-4 text-neutral-400">No encontramos una sala con ese código.</p>
      <Link href="/" className="mt-6 inline-block underline">Probar otro código</Link>
    </main>
  );
}
