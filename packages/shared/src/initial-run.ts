export type InitialRunStatus =
  | { status: 'no-run' }
  | { status: 'run-claimed' }
  | { status: 'run-recorded' };

export function initialRunStatus(
  lastUpdate: string | number | undefined,
  initialTrigger: string | number | undefined,
  nowMs: number,
): InitialRunStatus {
  const recorded = Number(lastUpdate);
  if (Number.isFinite(recorded) && recorded > 0) return { status: 'run-recorded' };
  const claimedAt = Number(initialTrigger);
  if (Number.isFinite(claimedAt) && claimedAt > 0 && nowMs - claimedAt < 60_000) {
    return { status: 'run-claimed' };
  }
  return { status: 'no-run' };
}
