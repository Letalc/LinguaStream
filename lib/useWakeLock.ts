"use client";

import { useEffect } from "react";

type WakeLockSentinelLike = { release: () => Promise<void> };

/**
 * Keeps the phone screen on while the audience reads subtitles. Browsers drop the lock
 * whenever the tab is hidden, so we re-acquire it when the page becomes visible again.
 * Needs HTTPS (works in production; ignored on plain-http LAN dev URLs).
 */
export function useWakeLock(enabled = true) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinelLike | null = null;
    let cancelled = false;

    const acquire = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock: { request: (t: "screen") => Promise<WakeLockSentinelLike> } }).wakeLock;
        const l = await wl.request("screen");
        if (cancelled) void l.release();
        else lock = l;
      } catch {
        // Denied (low battery, insecure context…): subtitles still work, the screen may dim.
      }
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquire();
    };

    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => {});
    };
  }, [enabled]);
}
