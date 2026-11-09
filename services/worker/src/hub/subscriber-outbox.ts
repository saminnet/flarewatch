import * as z from 'zod/mini';
import { parseJson } from './sql';

const batchSchema = z.object({
  sent: z.number(),
  body: z.string(),
  lastId: z.number(),
  size: z.number(),
  preparedAt: z.number(),
  day: z.number(),
});
type Batch = z.infer<typeof batchSchema>;

export enum OutboxStatus {
  Waiting = 'waiting',
  Sending = 'sending',
  Finished = 'finished',
}

type Cursor = { sentTo: number; batchIndex: number; attempts: number };
export type OutboxState = Cursor &
  (
    | { status: OutboxStatus.Waiting; batch: null }
    | { status: OutboxStatus.Sending; batch: Batch }
    | { status: OutboxStatus.Finished; batch: null }
  );
export type OutboxEvent =
  | { type: 'batch built'; batch: Batch }
  | { type: 'recipient sent' }
  | { type: 'day changed'; day: number }
  | { type: 'batch sent' }
  | { type: 'batch failed' }
  | { type: 'row finished' };

export function stepOutbox(state: OutboxState, event: OutboxEvent): OutboxState {
  if (state.status === OutboxStatus.Finished) return state;
  switch (event.type) {
    case 'row finished':
      return { ...state, status: OutboxStatus.Finished, batch: null };
    case 'batch built':
      return state.status === OutboxStatus.Waiting
        ? { ...state, status: OutboxStatus.Sending, batch: event.batch }
        : state;
    case 'recipient sent':
      return state.status === OutboxStatus.Sending
        ? {
            ...state,
            batch: { ...state.batch, sent: state.batch.sent + 1 },
          }
        : state;
    case 'day changed':
      return state.status === OutboxStatus.Sending
        ? { ...state, batch: { ...state.batch, day: event.day } }
        : state;
    case 'batch failed':
      return state.status === OutboxStatus.Sending
        ? { ...state, attempts: state.attempts + 1 }
        : state;
    case 'batch sent':
      return state.status === OutboxStatus.Sending
        ? {
            status: OutboxStatus.Waiting,
            sentTo: state.batch.lastId,
            batchIndex: state.batchIndex + 1,
            batch: null,
            attempts: 0,
          }
        : state;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export type OutboxColumns = {
  sent_to: number;
  batch_index: number;
  batch: string | null;
  attempts: number;
};

export function readOutbox(row: OutboxColumns): OutboxState {
  const cursor = { sentTo: row.sent_to, batchIndex: row.batch_index, attempts: row.attempts };
  return row.batch === null
    ? { ...cursor, status: OutboxStatus.Waiting, batch: null }
    : { ...cursor, status: OutboxStatus.Sending, batch: batchSchema.parse(parseJson(row.batch)) };
}

export function outboxColumns(state: OutboxState): OutboxColumns {
  return {
    sent_to: state.sentTo,
    batch_index: state.batchIndex,
    batch: state.batch === null ? null : JSON.stringify(state.batch),
    attempts: state.attempts,
  };
}
