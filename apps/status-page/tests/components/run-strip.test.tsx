// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vite-plus/test';

import { RunStrip } from '../../src/components/run-strip';
import { formatUtcShort } from '@flarewatch/shared';

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
