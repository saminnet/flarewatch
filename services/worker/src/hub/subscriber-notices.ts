export enum NoticeState {
  Waiting = 'waiting',
  DownSent = 'down-sent',
  RecoverySent = 'recovery-sent',
}

export type NoticeColumns = { subscriber_notified: number; subscriber_recovered: number };
export type NoticeEvent = 'down notice sent' | 'recovery notice sent' | 'reopen';

export function stepNotice(state: NoticeState, event: NoticeEvent): NoticeState {
  switch (event) {
    case 'reopen':
      return NoticeState.Waiting;
    case 'down notice sent':
      return state === NoticeState.Waiting ? NoticeState.DownSent : state;
    case 'recovery notice sent':
      return state === NoticeState.DownSent ? NoticeState.RecoverySent : state;
  }
}

export function readNotice(row: NoticeColumns): NoticeState {
  if (row.subscriber_recovered === 1) return NoticeState.RecoverySent;
  return row.subscriber_notified === 1 ? NoticeState.DownSent : NoticeState.Waiting;
}

export function noticeColumns(state: NoticeState): NoticeColumns {
  return {
    subscriber_notified: Number(state !== NoticeState.Waiting),
    subscriber_recovered: Number(state === NoticeState.RecoverySent),
  };
}
