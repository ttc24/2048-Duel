import { useEffect, useRef } from "react";

export function useIntervalSeq(
  callback: () => Promise<void> | void,
  delayMs: number | null
) {
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    let cancelled = false;

    async function loop() {
      if (delayMs === null) return;
      while (!cancelled) {
        const t0 = performance.now();
        await saved.current();
        const rest = Math.max(0, delayMs - (performance.now() - t0));
        await new Promise((r) => setTimeout(r, rest));
      }
    }

    if (delayMs !== null) loop();
    return () => {
      cancelled = true;
    };
  }, [delayMs]);
}
