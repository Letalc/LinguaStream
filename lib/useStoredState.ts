"use client";

import { useCallback, useMemo, useSyncExternalStore, type SetStateAction } from "react";

const CHANGE_EVENT = "live-subs-storage";
const fallback = new Map<string, string>();
const serverSnapshot = () => null;

/** Hydration-safe browser storage, including updates from other tabs. */
export function useStoredState<T>(
  key: string,
  initial: T,
  decode: (raw: string) => T,
  kind: "localStorage" | "sessionStorage" = "localStorage",
) {
  const getSnapshot = useCallback(() => {
    try { return window[kind].getItem(key); }
    catch { return fallback.get(`${kind}:${key}`) ?? null; }
  }, [key, kind]);
  const subscribe = useCallback((notify: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) notify();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, notify);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, notify);
    };
  }, [key]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
  const value = useMemo(() => {
    if (raw === null) return initial;
    try { return decode(raw); } catch { return initial; }
  }, [raw, initial, decode]);
  const setValue = useCallback((next: SetStateAction<T>) => {
    const currentRaw = getSnapshot();
    let current = initial;
    try { if (currentRaw !== null) current = decode(currentRaw); } catch {}
    const resolved = typeof next === "function" ? (next as (previous: T) => T)(current) : next;
    const serialized = JSON.stringify(resolved);
    try { window[kind].setItem(key, serialized); }
    catch { fallback.set(`${kind}:${key}`, serialized); }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, [key, kind, initial, decode, getSnapshot]);
  return [value, setValue] as const;
}

const subscribeHydration = () => () => {};
const clientHydrated = () => true;
const serverHydrated = () => false;
export function useHydrated() {
  return useSyncExternalStore(subscribeHydration, clientHydrated, serverHydrated);
}
