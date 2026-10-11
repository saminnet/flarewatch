// @vitest-environment jsdom

import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vite-plus/test';
import type { StatusView } from '@flarewatch/shared';

import { StatusBar } from '../../src/components/status-bar';

const NOW = 1_736_942_400;
const DAY = 86_400;
const state: StatusView = {
  lastUpdate: NOW,
  monitors: { api: { status: 'up', incidents: [], startedAt: NOW - 120 * DAY } },
};

function bars() {
  const { container } = render(<StatusBar monitorId="api" monitorName="API" state={state} />);
  const count = (selector: string) => container.querySelectorAll(`${selector} [aria-label]`).length;
  return { desktop: count('.sm\\:flex'), mobile: count('.sm\\:hidden') };
}

describe('StatusBar', () => {
  it('shows no mobile days before it knows its width', () => {
    expect(bars()).toEqual({ desktop: 90, mobile: 0 });
  });

  it('shows every day on a mobile bar wide enough for them', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      DOMRect.fromRect({ width: 10_000, height: 24 }),
    );
    expect(bars()).toEqual({ desktop: 90, mobile: 90 });
  });
});
