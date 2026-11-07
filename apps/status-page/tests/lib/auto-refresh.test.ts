import { expect, it } from 'vite-plus/test';
import { stepRefresh, type RefreshEvent, type RefreshState } from '@/lib/hooks/auto-refresh';

function replay(events: RefreshEvent[]) {
  let state: RefreshState = { status: 'waiting', currentTime: 900 };
  return events.map((event) => {
    const transition = stepRefresh(state, event);
    state = transition.state;
    return transition;
  });
}

const tick = (time: number, visible = true, lastUpdate = 900): RefreshEvent => ({
  type: 'tick',
  time,
  visible,
  lastUpdate,
});

it('hidden ticks do not invalidate or advance the open time', () => {
  expect(replay([tick(1000, false), tick(1020), tick(1050, false)])).toEqual([
    { state: { status: 'waiting', currentTime: 900 }, invalidate: false },
    {
      state: { status: 'open', currentTime: 1020, openTime: 1020, lastInvalidateAt: 0 },
      invalidate: false,
    },
    {
      state: { status: 'open', currentTime: 1020, openTime: 1020, lastInvalidateAt: 0 },
      invalidate: false,
    },
  ]);
});

it('waits through ten seconds after the first visible tick', () => {
  expect(
    replay([tick(1000), tick(1009), tick(1010), tick(1011)]).map(({ invalidate }) => invalidate),
  ).toEqual([false, false, false, true]);
});

it('invalidates a stalled worker once per thirty seconds', () => {
  const events = Array.from({ length: 73 }, (_, i) => tick(1000 + i));
  expect(
    replay(events).flatMap(({ invalidate }, i) => (invalidate ? [events[i]!.time] : [])),
  ).toEqual([1011, 1041, 1071]);
});

it('a new lastUpdate stops invalidations', () => {
  expect(
    replay([tick(1000), tick(1011), tick(1041, true, 1040), tick(1071, true, 1040)]).map(
      ({ invalidate }) => invalidate,
    ),
  ).toEqual([false, true, false, false]);
});
