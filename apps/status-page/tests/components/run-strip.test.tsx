// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { HEARTBEAT_RUN_HISTORY } from '@flarewatch/shared';
import type { HeartbeatView } from '@/lib/heartbeat';

// jsdom has no ResizeObserver; the stub never reports a width, which keeps the
// strip in its pre-measurement state for the whole test.
vi.stubGlobal(
  'ResizeObserver',
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

await import('../../src/lib/i18n');
const { RunStrip } = await import('../../src/components/run-strip');
const { formatUtcShort } = await import('@flarewatch/shared');

afterEach(cleanup);

const heartbeat: HeartbeatView = {
  phase: 'up',
  lastRunSec: HEARTBEAT_RUN_HISTORY,
  lastResult: 'success',
  nowSec: HEARTBEAT_RUN_HISTORY,
  runs: Array.from({ length: HEARTBEAT_RUN_HISTORY }, (_, i) => ({ at: i + 1, outcome: 'ok' })),
};

describe('RunStrip', () => {
  it('renders no mobile cells before the container is measured', () => {
    const { container } = render(
      <RunStrip heartbeat={heartbeat} periodSeconds={3600} graceSeconds={0} />,
    );

    const mobileGroup = container.querySelector<HTMLElement>('.sm\\:hidden [role="group"]');
    expect(mobileGroup).toBeTruthy();
    expect(mobileGroup!.children).toHaveLength(0);

    const desktopGroup = container.querySelector<HTMLElement>('.sm\\:flex [role="group"]');
    expect(desktopGroup).toBeTruthy();
    expect(desktopGroup!.children).toHaveLength(HEARTBEAT_RUN_HISTORY);
  });

  it('renders the strip and a next cell when empty', () => {
    const { container } = render(
      <RunStrip
        heartbeat={{ phase: 'pending', nowSec: 0 }}
        periodSeconds={3600}
        graceSeconds={0}
      />,
    );

    const desktopGroup = container.querySelector<HTMLElement>('.sm\\:flex [role="group"]');
    expect(desktopGroup).toBeTruthy();
    expect(desktopGroup!.children).toHaveLength(HEARTBEAT_RUN_HISTORY);

    const nextCell = desktopGroup!.parentElement!.querySelector(
      '[aria-label="Waiting for the first ping"]',
    );
    expect(nextCell).toBeTruthy();
  });

  it('labels a failed run cell with its time and outcome', () => {
    const { container } = render(
      <RunStrip
        heartbeat={{
          phase: 'up',
          lastRunSec: 1234,
          lastResult: 'fail',
          nowSec: 1234,
          runs: [{ at: 1234, outcome: 'fail' }],
        }}
        periodSeconds={3600}
        graceSeconds={0}
      />,
    );

    const failCell = container.querySelector('[role="group"] [aria-label*="Failed at"]');
    expect(failCell).toBeTruthy();
    expect(failCell!.getAttribute('aria-label')).toContain(formatUtcShort(1234));
  });

  it('opens the run detail on tap', async () => {
    const { container } = render(
      <RunStrip
        heartbeat={{
          phase: 'up',
          lastRunSec: 1234,
          lastResult: 'fail',
          nowSec: 1234,
          runs: [{ at: 1234, outcome: 'fail' }],
        }}
        periodSeconds={3600}
        graceSeconds={0}
      />,
    );

    const failCell = container.querySelector<HTMLElement>(
      '[role="group"] [aria-label*="Failed at"]',
    );
    fireEvent.click(failCell!);

    expect(await screen.findByText(`Failed at ${formatUtcShort(1234)}`)).toBeTruthy();
  });
});
