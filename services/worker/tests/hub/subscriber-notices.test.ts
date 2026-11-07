import { expect, it } from 'vite-plus/test';
import {
  NoticeState,
  readNotice,
  noticeColumns,
  stepNotice,
  type NoticeEvent,
} from '../../src/hub/subscriber-notices';

it('replays notices with reopen, duplicates and recovery before down', () => {
  const events: NoticeEvent[] = [
    'recovery notice sent',
    'down notice sent',
    'down notice sent',
    'recovery notice sent',
    'recovery notice sent',
    'reopen',
    'recovery notice sent',
    'down notice sent',
  ];
  let state = NoticeState.Waiting;
  const replay = events.map((event) => {
    state = stepNotice(readNotice(noticeColumns(state)), event);
    return state;
  });
  expect(replay).toEqual([
    NoticeState.Waiting,
    NoticeState.DownSent,
    NoticeState.DownSent,
    NoticeState.RecoverySent,
    NoticeState.RecoverySent,
    NoticeState.Waiting,
    NoticeState.Waiting,
    NoticeState.DownSent,
  ]);
});

it('round-trips each notice state through the columns', () => {
  for (const state of Object.values(NoticeState)) {
    expect(readNotice(noticeColumns(state))).toBe(state);
  }
});
