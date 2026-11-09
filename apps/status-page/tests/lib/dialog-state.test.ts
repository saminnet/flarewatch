import { expect, it } from 'vite-plus/test';
import { dialogStep, type DialogEvent, type DialogState } from '@/lib/dialog-state';

it('replays open close and open with the last target retained and a new remount key', () => {
  const events: DialogEvent<string>[] = [
    { type: 'open', target: 'API maintenance' },
    { type: 'close' },
    { type: 'open', target: 'Database maintenance' },
    { type: 'close' },
    { type: 'open' },
  ];
  let state: DialogState<string> = { status: 'closed', key: 0 };
  const replay = events.map((event) => (state = dialogStep(state, event)));
  expect(replay).toEqual([
    { status: 'open', target: 'API maintenance', key: 1 },
    { status: 'closed', target: 'API maintenance', key: 1 },
    { status: 'open', target: 'Database maintenance', key: 2 },
    { status: 'closed', target: 'Database maintenance', key: 2 },
    { status: 'open', target: undefined, key: 3 },
  ]);
});
