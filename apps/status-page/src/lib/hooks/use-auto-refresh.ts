import { useReducer, useEffect, useEffectEvent } from 'react';
import { refreshReducer, stepRefresh, type RefreshState } from './auto-refresh';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useWindowVisibility } from './use-window-visibility';
import { useHydrated } from './use-hydrated';
import { qk } from '@/lib/query/keys';
import {
  STALE_THRESHOLD_SECONDS,
  REFRESH_THRESHOLD_SECONDS,
  AUTO_REFRESH_MIN_OPEN_SECONDS,
} from '@/lib/constants';

interface UseAutoRefreshOptions {
  lastUpdate: number; // Unix timestamp in seconds
}

interface UseAutoRefreshReturn {
  currentTime: number;
  isHydrated: boolean;
  isStale: boolean;
  willRefreshSoon: boolean;
  refreshCountdown: number | null;
}

export function useAutoRefresh({ lastUpdate }: UseAutoRefreshOptions): UseAutoRefreshReturn {
  const router = useRouter();
  const queryClient = useQueryClient();
  const isWindowVisible = useWindowVisibility();
  const isHydrated = useHydrated();

  const [state, dispatch] = useReducer(refreshReducer, {
    status: 'waiting',
    currentTime: lastUpdate,
  });
  const currentTime = state.currentTime;
  const openTime = state.status === 'open' ? state.openTime : lastUpdate;

  // Use stable time for SSR to avoid hydration mismatch
  const displayTime = isHydrated ? currentTime : lastUpdate;
  const displayOpenTime = isHydrated ? openTime : lastUpdate;

  const dataAge = displayTime - lastUpdate;
  const isStale = dataAge > STALE_THRESHOLD_SECONDS;
  const pageOpenedLongEnough = currentTime - displayOpenTime > AUTO_REFRESH_MIN_OPEN_SECONDS;
  const needsRefresh = dataAge > REFRESH_THRESHOLD_SECONDS;
  const willRefreshSoon = needsRefresh && pageOpenedLongEnough && isWindowVisible;
  const refreshCountdown = needsRefresh
    ? Math.max(0, AUTO_REFRESH_MIN_OPEN_SECONDS - (currentTime - displayOpenTime))
    : null;

  const tick = useEffectEvent((previous: RefreshState | undefined) => {
    const event = {
      type: 'tick' as const,
      time: Math.round(Date.now() / 1000),
      visible: isWindowVisible,
      lastUpdate,
    };
    const transition = stepRefresh(previous ?? state, event);
    dispatch(event);
    if (transition.invalidate) {
      void queryClient.invalidateQueries({ queryKey: qk.snapshot });
      void router.invalidate();
    }
    return transition.state;
  });

  useEffect(() => {
    let previous: RefreshState | undefined;
    const interval = setInterval(() => {
      previous = tick(previous);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return {
    currentTime: displayTime,
    isHydrated,
    isStale,
    willRefreshSoon,
    refreshCountdown,
  };
}
