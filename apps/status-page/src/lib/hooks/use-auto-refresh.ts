import { useRef, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useWindowVisibility } from './use-window-visibility';
import { useHydrated } from './use-hydrated';
import { qk } from '@/lib/query/keys';
import { STALE_THRESHOLD_SECONDS, AUTO_REFRESH_MIN_OPEN_SECONDS } from '@/lib/constants';

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

  const [currentTime, setCurrentTime] = useState(lastUpdate);
  const [openTime, setOpenTime] = useState(lastUpdate);
  const openTimeRef = useRef(lastUpdate);
  const openTimeInitialized = useRef(false);
  const lastInvalidateAt = useRef(0);

  // Use stable time for SSR to avoid hydration mismatch
  const displayTime = isHydrated ? currentTime : lastUpdate;
  const displayOpenTime = isHydrated ? openTime : lastUpdate;

  // Calculate refresh state
  const dataAge = displayTime - lastUpdate;
  const isStale = dataAge > STALE_THRESHOLD_SECONDS;
  const pageOpenedLongEnough = currentTime - displayOpenTime > AUTO_REFRESH_MIN_OPEN_SECONDS;
  const willRefreshSoon = isStale && pageOpenedLongEnough && isWindowVisible;
  const refreshCountdown = isStale
    ? Math.max(0, AUTO_REFRESH_MIN_OPEN_SECONDS - (currentTime - displayOpenTime))
    : null;

  // Auto-refresh if data is stale (>5 minutes old)
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isWindowVisible) return;
      const now = Math.round(Date.now() / 1000);

      if (!openTimeInitialized.current) {
        openTimeInitialized.current = true;
        openTimeRef.current = now;
        setOpenTime(now);
      }

      const openTime = openTimeRef.current;

      // Revalidate loader data instead of doing a full page reload.
      // Use a cooldown to avoid hammering KV if the worker isn't updating.
      if (
        now - lastUpdate > STALE_THRESHOLD_SECONDS &&
        now - openTime > AUTO_REFRESH_MIN_OPEN_SECONDS
      ) {
        if (now - lastInvalidateAt.current >= AUTO_REFRESH_MIN_OPEN_SECONDS) {
          lastInvalidateAt.current = now;
          void queryClient.invalidateQueries({ queryKey: qk.monitorState });
          void router.invalidate();
        }
      }
      setCurrentTime(now);
    }, 1000);
    return () => clearInterval(interval);
  }, [isWindowVisible, lastUpdate, queryClient, router]);

  return {
    currentTime: displayTime,
    dataAge,
    isStale,
    willRefreshSoon,
    refreshCountdown,
  };
}
