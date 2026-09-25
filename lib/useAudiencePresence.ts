"use client";

import { useMutation } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { Id } from "@/convex/_generated/dataModel";

const HEARTBEAT_MS = 60_000;
const VIEWER_KEY = "live-subs-viewer-id";

/** Heartbeat only: audience devices never download the room's member list. */
export function useAudiencePresence(roomId: Id<"sessions">, enabled: boolean) {
  const heartbeat = useMutation(api.presence.heartbeat);
  const disconnect = useMutation(api.presence.disconnect);
  const [userId] = useState(readOrCreateViewerId);
  const [sessionId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let sessionToken: string | null = null;

    const pulse = async () => {
      try {
        const result = await heartbeat({ roomId, userId, sessionId });
        if (stopped) void disconnect({ sessionToken: result.sessionToken }).catch(() => {});
        else sessionToken = result.sessionToken;
      } catch {
        // A temporary network failure expires naturally after 2.5 intervals.
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void pulse();
    };

    void pulse();
    const timer = window.setInterval(pulse, HEARTBEAT_MS);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      if (sessionToken) void disconnect({ sessionToken }).catch(() => {});
    };
  }, [disconnect, enabled, heartbeat, roomId, sessionId, userId]);
}

function readOrCreateViewerId() {
  try {
    const saved = localStorage.getItem(VIEWER_KEY);
    if (saved) return saved;
    const created = crypto.randomUUID();
    localStorage.setItem(VIEWER_KEY, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}
