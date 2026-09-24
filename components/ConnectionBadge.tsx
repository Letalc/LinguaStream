"use client";

import { useConvexConnectionState } from "convex/react";

/** Tells the viewer when live updates are paused (phone slept, Wi-Fi dropped…). */
export function ConnectionBadge() {
  const state = useConvexConnectionState();
  if (state.isWebSocketConnected || !state.hasEverConnected) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-50 bg-amber-500 py-1 text-center text-sm font-medium text-black">
      Reconectando… los subtítulos se actualizan solos al volver la conexión
    </div>
  );
}
