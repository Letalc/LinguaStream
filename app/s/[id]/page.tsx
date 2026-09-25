import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { AudienceView } from "./AudienceView";

export default async function AudiencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Invalid ids throw a validation error: fall back to the client query, which shows "not found".
  const initialSession = await fetchQuery(api.sessions.get, { sessionId: id as Id<"sessions"> }).catch(() => undefined);
  return <AudienceView id={id} initialSession={initialSession} />;
}
