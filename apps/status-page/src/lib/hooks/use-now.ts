import { useState, useEffect } from 'react';
import { useHydrated } from './use-hydrated';

interface UseNowOptions {
  serverTime: number;
  interval?: number;
  enabled?: boolean;
}

/**
 * SSR-safe hook for current time that avoids hydration mismatches.
 *
 * Returns `serverTime` until hydration completes, then switches to
 * live `Date.now()` with automatic refresh.
 */
export function useNow({ serverTime, interval = 60_000, enabled = true }: UseNowOptions): number {
  const isHydrated = useHydrated();
  const [clientTime, setClientTime] = useState(serverTime);

  useEffect(() => {
    if (!enabled) return;

    // Sync to real time immediately after hydration
    setClientTime(Date.now());

    const id = setInterval(() => setClientTime(Date.now()), interval);
    return () => clearInterval(id);
  }, [interval, enabled]);

  return isHydrated ? clientTime : serverTime;
}
