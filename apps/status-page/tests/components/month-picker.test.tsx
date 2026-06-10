// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { MonthPicker } from '../../src/components/ui/month-picker';

afterEach(cleanup);

describe('MonthPicker', () => {
  it('selects a month from the displayed year', async () => {
    const changes: string[] = [];

    render(<MonthPicker value="2026-06" onChange={(value) => changes.push(value)} />);

    fireEvent.click(screen.getByRole('button', { name: /Jun 2026/i }));
    expect(await screen.findByText('2026')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Next year' }));
    expect(screen.getByText('2027')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Jan' }));

    expect(changes).toEqual(['2027-01']);
  });

  it('opens on the current selected year after an external value change', async () => {
    const { rerender } = render(<MonthPicker value="2026-06" onChange={() => {}} />);

    rerender(<MonthPicker value="2028-03" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Mar 2028/i }));

    expect(await screen.findByText('2028')).toBeTruthy();
  });
});
