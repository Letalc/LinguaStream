"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "live-subs-admin-key";

// The admin password lives only in this browser (localStorage), never in the URL.
export function useAdminKey() {
  const [key, setKeyState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setKeyState(localStorage.getItem(STORAGE_KEY));
    } catch {}
    setLoaded(true);
  }, []);

  const setKey = useCallback((value: string | null) => {
    try {
      if (value) localStorage.setItem(STORAGE_KEY, value);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setKeyState(value);
  }, []);

  return { key, setKey, loaded };
}
