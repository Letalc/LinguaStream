"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useHydrated } from "./useStoredState";

const STORAGE_KEY = "live-subs-admin-key";
const CHANGE_EVENT = "live-subs-admin-key-change";
let fallbackKey: string | null = null;
const readKey = () => {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return fallbackKey; }
};
const subscribe = (notify: () => void) => {
  window.addEventListener("storage", notify);
  window.addEventListener(CHANGE_EVENT, notify);
  return () => {
    window.removeEventListener("storage", notify);
    window.removeEventListener(CHANGE_EVENT, notify);
  };
};
const serverSnapshot = () => null;

// Preserve the existing raw storage format; never put the password in a URL.
export function useAdminKey() {
  const key = useSyncExternalStore(subscribe, readKey, serverSnapshot);
  const loaded = useHydrated();
  const setKey = useCallback((value: string | null) => {
    fallbackKey = value;
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return { key, setKey, loaded };
}
