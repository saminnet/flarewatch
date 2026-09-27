import { useState, useEffect } from 'react';
import { useHydrated } from './use-hydrated';

interface UseNowOptions {
  serverTime: number;
  interval?: number;
  enabled?: boolean;
}

/** Returns `serverTime` until hydration completes to avoid an SSR mismatch, then live time. */
export function useNow({ serverTime, interval = 60_000, enabled = true }: UseNowOptions): number {
  const isHydrated = useHydrated();
  const [clientTime, setClientTime] = useState(serverTime);

  useEffect(() => {
    if (!enabled) return;

    const initialTick = setTimeout(() => setClientTime(Date.now()), 0);
    const id = setInterval(() => setClientTime(Date.now()), interval);
    return () => {
      clearTimeout(initialTick);
      clearInterval(id);
    };
  }, [interval, enabled]);

  return isHydrated ? clientTime : serverTime;
}
