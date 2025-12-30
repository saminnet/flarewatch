import { useRef, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useWindowVisibility } from './use-window-visibility';
import { useHydrated } from '@/lib/hydrated';
import { qk } from '@/lib/query/keys';

const STALE_THRESHOLD = 300; // 5 minutes in seconds
const MIN_OPEN_TIME = 10; // Wait 10 seconds after opening before auto-refresh

interface UseAutoRefreshOptions {
  lastUpdate: number; // Unix timestamp in seconds
}

interface UseAutoRefreshReturn {
  currentTime: number;
  dataAge: number;
  isStale: boolean;
  willRefreshSoon: boolean;
  refreshCountdown: number | null;
}

export function useAutoRefresh({ lastUpdate }: UseAutoRefreshOptions): UseAutoRefreshReturn {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWindowVisible = useWindowVisibility();
  const isHydrated = useHydrated();

  const [openTime] = useState(Math.round(Date.now() / 1000));
  const [currentTime, setCurrentTime] = useState(lastUpdate);
  const lastInvalidateAt = useRef(0);

  // Use stable time for SSR to avoid hydration mismatch
  const displayTime = isHydrated ? currentTime : lastUpdate;

  // Calculate refresh state
  const dataAge = displayTime - lastUpdate;
  const isStale = dataAge > STALE_THRESHOLD;
  const pageOpenedLongEnough = currentTime - openTime > MIN_OPEN_TIME;
  const willRefreshSoon = isStale && pageOpenedLongEnough && isWindowVisible;
  const refreshCountdown = isStale ? Math.max(0, MIN_OPEN_TIME - (currentTime - openTime)) : null;

  // Auto-refresh if data is stale (>5 minutes old)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isWindowVisible) return;
      const now = Math.round(Date.now() / 1000);

      // Revalidate loader data instead of doing a full page reload.
      // Use a cooldown to avoid hammering KV if the worker isn't updating.
      if (now - lastUpdate > STALE_THRESHOLD && now - openTime > MIN_OPEN_TIME) {
        if (now - lastInvalidateAt.current >= MIN_OPEN_TIME) {
          lastInvalidateAt.current = now;
          void queryClient.invalidateQueries({ queryKey: qk.monitorState });
          void router.invalidate();
        }
      }
      setCurrentTime(now);
    }, 1000);
    return () => clearInterval(interval);
  }, [isWindowVisible, lastUpdate, openTime, queryClient, router]);

  return {
    currentTime: displayTime,
    dataAge,
    isStale,
    willRefreshSoon,
    refreshCountdown,
  };
}
