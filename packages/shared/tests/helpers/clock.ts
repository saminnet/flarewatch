import { vi } from 'vite-plus/test';

/**
 * Stops the clock at `at`: every timer, or only `Date` when timers must keep running.
 * @flarewatch/vitest-config/setup restores real timers after each test.
 */
export function freezeClock(at: number | Date, { dateOnly = false } = {}): void {
  vi.useFakeTimers(dateOnly ? { toFake: ['Date'] } : undefined);
  vi.setSystemTime(at);
}
