// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vite-plus/test';

import { DateTimePicker } from '@/components/ui/datetime-picker';

const originalTimeZone = process.env.TZ;

// A host zone west of UTC puts 2026-06-10T02:00Z on June 9 locally, so local and UTC math disagree.
beforeAll(() => {
  process.env.TZ = 'America/Los_Angeles';
});

afterAll(() => {
  process.env.TZ = originalTimeZone;
});

afterEach(cleanup);

describe('DateTimePicker', () => {
  const value = new Date('2026-06-10T02:00:00Z');

  it('shows the value in UTC', () => {
    render(<DateTimePicker value={value} />);

    expect(screen.getByRole('button', { name: /Jun 10, 2026 02:00 UTC/ })).toBeTruthy();
  });

  it('keeps the UTC time when another day is picked', async () => {
    const changes: (Date | undefined)[] = [];
    render(<DateTimePicker value={value} onChange={(date) => changes.push(date)} />);

    fireEvent.click(screen.getByRole('button', { name: /Jun 10, 2026/ }));
    fireEvent.click(await screen.findByRole('button', { name: /June 15th, 2026/ }));

    expect(changes.map((date) => date?.toISOString())).toEqual(['2026-06-15T02:00:00.000Z']);
  });
});
