import { afterEach, vi } from 'vite-plus/test';

// Not spies: restoreMocks undoes spies before each test.
for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
  console[level] = () => {};
}

afterEach(() => {
  vi.useRealTimers();
});
