import {
  AUTO_REFRESH_MIN_OPEN_SECONDS,
  REFRESH_COOLDOWN_SECONDS,
  REFRESH_THRESHOLD_SECONDS,
} from '../constants';

export type RefreshState =
  | { status: 'waiting'; currentTime: number }
  | { status: 'open'; currentTime: number; openTime: number; lastInvalidateAt: number };

export type RefreshEvent = { type: 'tick'; time: number; visible: boolean; lastUpdate: number };

type RefreshTransition = { state: RefreshState; invalidate: boolean };

export function stepRefresh(state: RefreshState, event: RefreshEvent): RefreshTransition {
  if (!event.visible) return { state, invalidate: false };
  switch (state.status) {
    case 'waiting':
      return {
        state: {
          status: 'open',
          currentTime: event.time,
          openTime: event.time,
          lastInvalidateAt: 0,
        },
        invalidate: false,
      };
    case 'open': {
      const invalidate =
        event.time - event.lastUpdate > REFRESH_THRESHOLD_SECONDS &&
        event.time - state.openTime > AUTO_REFRESH_MIN_OPEN_SECONDS &&
        event.time - state.lastInvalidateAt >= REFRESH_COOLDOWN_SECONDS;
      return {
        state: {
          ...state,
          currentTime: event.time,
          lastInvalidateAt: invalidate ? event.time : state.lastInvalidateAt,
        },
        invalidate,
      };
    }
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export function refreshReducer(state: RefreshState, event: RefreshEvent): RefreshState {
  return stepRefresh(state, event).state;
}
