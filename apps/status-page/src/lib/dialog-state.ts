export type DialogState<T = undefined> = {
  status: 'closed' | 'open';
  target?: T;
  key: number;
};

export type DialogEvent<T = undefined> = { type: 'open'; target?: T } | { type: 'close' };

export const CLOSED_DIALOG: DialogState<never> = { status: 'closed', key: 0 };

/** A closed dialog keeps its target so it can animate out. Each open remounts it with a new key. */
export function dialogStep<T>(state: DialogState<T>, event: DialogEvent<T>): DialogState<T> {
  switch (event.type) {
    case 'open':
      return { status: 'open', target: event.target, key: state.key + 1 };
    case 'close':
      return { ...state, status: 'closed' };
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}
