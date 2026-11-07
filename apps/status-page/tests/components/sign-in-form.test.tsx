// @vitest-environment jsdom
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { SignInForm } from '@/components/sign-in-form';
import { renderWithProviders } from '../helpers/render';

it('replaces the provider error with the mutation error and clears it on retry', async () => {
  const fetch = vi.fn(async () => Response.json({ error: 'Wrong password' }, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  renderWithProviders(<SignInForm privateOnly passwordSignIn providers={[]} error="denied" />);
  expect(screen.getByRole('alert').textContent).toBe(
    'This account is not allowed to sign in here.',
  );
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'operator' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Wrong password'));
  let answer: (response: Response) => void = () => {};
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('button', { name: 'Signing in...' })).toBeTruthy();
  expect(screen.queryByRole('alert')).toBeNull();
  answer(Response.json({ error: 'Try later' }, { status: 429 }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('Try later'));
});
