import { afterEach, vi } from 'vite-plus/test';

// Not spies: restoreMocks undoes spies before each test.
for (const level of ['log', 'info', 'debug', 'warn', 'error'] as const) {
  console[level] = () => {};
}

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

afterEach(() => {
  vi.useRealTimers();
});
