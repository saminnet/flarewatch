import baseline from '../fixtures/hub-lifecycle-logs.json';

interface CapturedEntry {
  token: string;
  now?: number;
  policy?: { skipIds: string[] } | null;
  alerts?: { kind: string; run: number; reopenedAt: number | null; reminder?: number }[];
  outcomes?: {
    kind: string;
    run: number;
    reopenedAt: number | null;
    delivered: boolean;
    deferred?: boolean;
  }[];
  updates?: { changeType: string }[];
}

export function capturedLifecycle(name: string): readonly CapturedEntry[] {
  return baseline.find((log) => log.name === name)?.log ?? [];
}
