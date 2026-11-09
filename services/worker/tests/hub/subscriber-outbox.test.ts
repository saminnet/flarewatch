import { expect, it } from 'vite-plus/test';
import {
  readOutbox,
  outboxColumns,
  stepOutbox,
  OutboxStatus,
  type OutboxEvent,
} from '../../src/hub/subscriber-outbox';

it('replays an outbox row across failure, partial send, midnight, success and finish', () => {
  let state = readOutbox({ sent_to: 0, batch_index: 0, batch: null, attempts: 0 });
  const batch = {
    sent: 0,
    body: '["one@example.com","two@example.com"]',
    lastId: 2,
    size: 2,
    preparedAt: 100,
    day: 0,
  };
  const events: OutboxEvent[] = [
    { type: 'batch built', batch },
    { type: 'batch failed' },
    { type: 'recipient sent' },
    { type: 'day changed', day: 1 },
    { type: 'batch sent' },
    { type: 'row finished' },
  ];
  const replay = events.map((event) => {
    const before = JSON.stringify(state);
    const previous = state;
    state = stepOutbox(state, event);
    expect(JSON.stringify(previous)).toBe(before);
    const result = outboxColumns(state);
    if (state.status !== OutboxStatus.Finished) state = readOutbox(result);
    return { status: state.status, ...result };
  });
  expect(replay).toEqual([
    { status: 'sending', sent_to: 0, batch_index: 0, batch: JSON.stringify(batch), attempts: 0 },
    { status: 'sending', sent_to: 0, batch_index: 0, batch: JSON.stringify(batch), attempts: 1 },
    {
      status: 'sending',
      sent_to: 0,
      batch_index: 0,
      batch: JSON.stringify({ ...batch, sent: 1 }),
      attempts: 1,
    },
    {
      status: 'sending',
      sent_to: 0,
      batch_index: 0,
      batch: JSON.stringify({ ...batch, sent: 1, day: 1 }),
      attempts: 1,
    },
    { status: 'waiting', sent_to: 2, batch_index: 1, batch: null, attempts: 0 },
    { status: 'finished', sent_to: 2, batch_index: 1, batch: null, attempts: 0 },
  ]);
});
