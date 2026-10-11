"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: string | null;
  loading: boolean;
  /** Fetch again without blanking the screen. */
  reload: () => Promise<void>;
}

/**
 * Runs an async function when its inputs change, and optionally again every `refreshMs` so the screen stays
 * roughly live. Out-of-date answers are ignored.
 */
export function useAsync<T>(load: () => Promise<T>, deps: unknown[], refreshMs?: number): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const run = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const result = await loadRef.current();
      if (ticket !== latest.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (ticket !== latest.current) return;
      setError(messageOf(e));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    if (!refreshMs) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void run();
    }, refreshMs);
    return () => clearInterval(id);
  }, [refreshMs, run]);

  return { data, error, loading, reload: run };
}

export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : "Something went wrong");
