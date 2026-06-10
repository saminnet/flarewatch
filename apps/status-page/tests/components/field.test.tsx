// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vite-plus/test';

import { Field, FieldError } from '../../src/components/ui/field';

afterEach(cleanup);

describe('Field', () => {
  it('renders as a plain layout container', () => {
    render(
      <Field data-testid="field">
        <span>Server URL</span>
      </Field>,
    );

    expect(screen.getByTestId('field').getAttribute('role')).toBeNull();
  });

  it('deduplicates generated error messages', () => {
    render(
      <FieldError
        errors={[
          { message: 'Required' },
          { message: 'Required' },
          { message: 'Must be a valid URL' },
        ]}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('Required');
    expect(screen.getByRole('alert').textContent).toContain('Must be a valid URL');
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Required',
      'Must be a valid URL',
    ]);
  });
});
