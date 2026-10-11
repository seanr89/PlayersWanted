"use client";

import { useCallback, useState } from "react";
import { messageOf } from "./use-async";

/**
 * One button press that does something and may fail: tracks "working" and the error. Every action in the UI goes
 * through this, so busy and error handling behave the same everywhere. `run` resolves to whether it succeeded.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (task: () => Promise<unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      await task();
      return true;
    } catch (e) {
      setError(messageOf(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { busy, error, run };
}
