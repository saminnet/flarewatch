// @vitest-environment jsdom
import { useState } from 'react';
import { expect, it } from 'vite-plus/test';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  IncidentFields,
  type IncidentFieldsValue,
} from '@/components/announcements/incident-fields';

it('renders a retained stale monitor as a selected chip and removes it on click', () => {
  function Form() {
    const [value, onChange] = useState<IncidentFieldsValue>({
      kind: 'incident',
      status: 'investigating',
      monitors: ['retired-api'],
    });
    return (
      <IncidentFields value={value} onChange={onChange} monitors={[]} editing updateCount={0} />
    );
  }
  render(<Form />);
  const chip = screen.getByRole('button', { name: 'retired-api', pressed: true });
  fireEvent.click(chip);
  expect(screen.queryByRole('button', { name: 'retired-api' })).toBeNull();
});
