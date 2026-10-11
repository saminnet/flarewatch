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

function days() {
  const { container } = render(<StatusBar monitorId="api" monitorName="API" state={state} />);
  const labels = (selector: string) =>
    [...container.querySelectorAll(`${selector} [aria-label]`)].map((day) =>
      day.getAttribute('aria-label'),
    );
  return { desktop: labels('.sm\\:flex'), mobile: labels('.sm\\:hidden') };
}

function bars() {
  const { desktop, mobile } = days();
  return { desktop: desktop.length, mobile: mobile.length };
}

function measureWidth(width: number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ width, height: 24 }),
  );
}

describe('StatusBar', () => {
  it('shows no mobile days before it knows its width', () => {
    expect(bars()).toEqual({ desktop: 90, mobile: 0 });
  });

  it('shows every day on a mobile bar wide enough for them', () => {
    measureWidth(10_000);
    expect(bars()).toEqual({ desktop: 90, mobile: 90 });
  });

  it('shows the latest days that fit on a phone-width bar', () => {
    measureWidth(360);
    const { desktop, mobile } = days();
    expect(mobile.length).toBeGreaterThan(0);
    expect(mobile.length).toBeLessThan(desktop.length);
    expect(mobile).toEqual(desktop.slice(-mobile.length));
  });
});
