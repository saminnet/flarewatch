// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

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

const { RunStrip } = await import('../../src/components/run-strip');
const { formatUtcShort } = await import('@flarewatch/shared');

afterEach(cleanup);

describe('RunStrip', () => {
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
