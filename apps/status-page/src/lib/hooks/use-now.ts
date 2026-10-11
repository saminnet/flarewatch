import { useState, useEffect } from 'react';
import { useHydrated } from './use-hydrated';

interface UseNowOptions {
  serverTime: number;
}

/** Returns `serverTime` until hydration completes to avoid an SSR mismatch, then live time. */
export function useNow({ serverTime }: UseNowOptions): number {
  const isHydrated = useHydrated();
  const [clientTime, setClientTime] = useState(serverTime);

  useEffect(() => {
    const initialTick = setTimeout(() => setClientTime(Date.now()), 0);
    const id = setInterval(() => setClientTime(Date.now()), 60_000);
    return () => {
      clearTimeout(initialTick);
      clearInterval(id);
    };
  }, []);

  return isHydrated ? clientTime : serverTime;
}
