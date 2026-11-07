// @vitest-environment jsdom

import { expect, it, vi } from 'vite-plus/test';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { act } from '@testing-library/react';
import { useAutoRefresh } from '@/lib/hooks/use-auto-refresh';
import { withProviders } from '../helpers/render';

function Probe() {
  const { isHydrated, ...display } = useAutoRefresh({ lastUpdate: 900 });
  return <output data-hydrated={String(isHydrated)}>{JSON.stringify(display)}</output>;
}

it('uses lastUpdate only before hydration on server and client', async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  const html = renderToString(withProviders(<Probe />));
  const container = document.createElement('div');
  container.innerHTML = html;
  expect(container.textContent).toBe(
    '{"currentTime":900,"isStale":false,"willRefreshSoon":false,"refreshCountdown":null}',
  );
  const errors = vi.fn();
  const root = hydrateRoot(container, withProviders(<Probe />), { onRecoverableError: errors });
  try {
    await act(async () => {
      await Promise.resolve();
    });
    expect(errors).not.toHaveBeenCalled();
    expect(container.textContent).toBe(
      '{"currentTime":900,"isStale":false,"willRefreshSoon":false,"refreshCountdown":null}',
    );
  } finally {
    act(() => root.unmount());
  }
});
