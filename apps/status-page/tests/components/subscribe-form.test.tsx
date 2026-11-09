// @vitest-environment jsdom
import { QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vite-plus/test';
import { Header } from '@/components/header';
import type { SubscriberSettings } from '@/lib/config';
import { qk } from '@/lib/query/keys';
import type { Session } from '@/lib/session';
import { createTestQueryClient } from '../helpers/render';

const visitor: Session = {
  viewer: 'visitor',
  name: null,
  signedInAt: null,
  canSignIn: false,
  passwordSignIn: false,
  providers: [],
  privateOnly: false,
};
const operator: Session = { ...visitor, viewer: 'operator', name: 'Ada', canSignIn: true };
const member: Session = { ...visitor, viewer: 'member', name: 'Bo', canSignIn: true };
const enabled: SubscriberSettings = { enabled: true, siteKey: null };
const FAILED = 'Could not subscribe. Try again in a minute.';

function renderHeader({
  subscribers = enabled,
  session = visitor,
  visitorView = false,
  subscriberCount,
}: {
  subscribers?: SubscriberSettings;
  session?: Session;
  visitorView?: boolean;
  subscriberCount?: number;
} = {}) {
  const client = createTestQueryClient();
  if (subscriberCount !== undefined) client.setQueryData(qk.operatorSnapshot, { subscriberCount });
  const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() });
  const view = render(
    <QueryClientProvider client={client}>
      <RouterContextProvider router={router}>
        <Header subscribers={subscribers} session={session} visitorView={visitorView} />
      </RouterContextProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

const trigger = () => screen.queryByRole('button', { name: 'Get updates' });

async function openForm() {
  const button = trigger();
  if (!button) throw new Error('Get updates button missing');
  fireEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: 'Get updates by email' });
  return { button, dialog };
}

function submit(dialog: HTMLElement, email = 'person@example.com') {
  fireEvent.change(within(dialog).getByLabelText('Email address'), { target: { value: email } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Subscribe' }));
}

async function openAccountMenu() {
  fireEvent.click(screen.getByRole('button', { name: /^Account menu/ }));
  return screen.findByRole('menu');
}

it('shows Get updates only to visitors when subscriptions are enabled', () => {
  const { unmount } = renderHeader({ subscribers: { enabled: false, siteKey: null } });
  expect(trigger()).toBeNull();
  unmount();
  const { unmount: unmountMember } = renderHeader({ session: member });
  expect(trigger()).toBeNull();
  unmountMember();
  renderHeader();
  expect(trigger()?.getAttribute('aria-expanded')).toBe('false');
});

it('opens the form with focus on the email input and returns focus on close', async () => {
  renderHeader();
  const { button, dialog } = await openForm();
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(within(dialog).getByText('When a monitor goes down or recovers.')).toBeTruthy();
  const input = within(dialog).getByLabelText('Email address');
  await waitFor(() => expect(document.activeElement).toBe(input));
  fireEvent.keyDown(input, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(button);
});

it('confirms the signup with the address it was sent to and moves focus to it', async () => {
  const network = vi.fn(async () => new Response('Check your inbox.'));
  vi.stubGlobal('fetch', network);
  renderHeader();
  const { dialog } = await openForm();
  submit(dialog, 'ops-team@northwind.example');
  const status = await within(dialog).findByRole('status');
  expect(within(status).getByText('Check your inbox')).toBeTruthy();
  expect(within(status).getByText('ops-team@northwind.example')).toBeTruthy();
  expect(document.activeElement).toBe(status);
  expect(within(dialog).queryByLabelText('Email address')).toBeNull();
  expect(network).toHaveBeenCalledTimes(1);
});

it('shows a plain-text server error and allows another attempt', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Too many attempts. Try again in a minute.', { status: 429 })),
  );
  renderHeader();
  const { dialog } = await openForm();
  submit(dialog);
  const alert = await within(dialog).findByRole('alert');
  expect(alert.textContent).toBe('Too many attempts. Try again in a minute.');
  expect(within(dialog).getByLabelText('Email address').getAttribute('aria-describedby')).toBe(
    alert.id,
  );
  expect(within(dialog).getByRole('button', { name: 'Subscribe' }).hasAttribute('disabled')).toBe(
    false,
  );
});

it.each([
  [
    'an HTML error page',
    () =>
      new Response('<!DOCTYPE html><title>Error 1102</title><h1>Worker exceeded limits</h1>', {
        status: 502,
        headers: { 'Content-Type': 'text/html; charset=UTF-8' },
      }),
  ],
  ['an overlong error text', () => new Response('The hub was reset. '.repeat(10), { status: 503 })],
  ['an empty error body', () => new Response('', { status: 500 })],
])('shows a short generic error instead of %s', async (_case, reply) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => reply()),
  );
  renderHeader();
  const { dialog } = await openForm();
  submit(dialog);
  expect((await within(dialog).findByRole('alert')).textContent).toBe(FAILED);
});

it('shows a generic error when the request cannot reach the server', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }),
  );
  renderHeader();
  const { dialog } = await openForm();
  submit(dialog);
  expect((await within(dialog).findByRole('alert')).textContent).toBe(FAILED);
});

it('disables signup when Turnstile is required but has no site key', async () => {
  renderHeader({ subscribers: { enabled: true, siteKey: '' } });
  const { dialog } = await openForm();
  expect(within(dialog).getByRole('alert').textContent).toBe(
    'Email updates are unavailable. Try again later.',
  );
  expect(within(dialog).getByRole('button', { name: 'Subscribe' }).hasAttribute('disabled')).toBe(
    true,
  );
});

it('renders Turnstile in the page theme and refreshes its token after a failed request', async () => {
  const reset = vi.fn();
  const renderWidget = vi.fn(() => 'widget');
  window.turnstile = { render: renderWidget, remove: vi.fn(), reset };
  document.documentElement.classList.add('dark');
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('Verification failed. Try again.', { status: 400 })),
  );
  const { unmount } = renderHeader({ subscribers: { enabled: true, siteKey: 'site-key' } });
  const { dialog } = await openForm();
  const script = document.querySelector('script[src^="https://challenges.cloudflare.com/"]');
  if (!script) throw new Error('Turnstile script missing');
  fireEvent.load(script);
  expect(renderWidget).toHaveBeenCalledWith(expect.any(HTMLElement), {
    sitekey: 'site-key',
    theme: 'dark',
  });
  submit(dialog);
  await waitFor(() => expect(reset).toHaveBeenCalledWith('widget'));
  unmount();
  document.documentElement.classList.remove('dark');
  delete window.turnstile;
});

it('says so when the Turnstile script cannot load', async () => {
  const { unmount } = renderHeader({ subscribers: { enabled: true, siteKey: 'site-key' } });
  const { dialog } = await openForm();
  const script = document.querySelector('script[src^="https://challenges.cloudflare.com/"]');
  if (!script) throw new Error('Turnstile script missing');
  fireEvent.error(script);
  expect(
    await within(dialog).findByText(
      'The verification check did not load. Reload the page to try again.',
    ),
  ).toBeTruthy();
  unmount();
});

it.each([
  [3, '3 email subscribers'],
  [1, '1 email subscriber'],
  [0, 'No email subscribers yet'],
])('shows operators %i subscribers in the account menu, not in the header', async (count, text) => {
  const network = vi.fn();
  vi.stubGlobal('fetch', network);
  renderHeader({ session: operator, subscriberCount: count });
  expect(trigger()).toBeNull();
  const menu = await openAccountMenu();
  expect(within(menu).getByText(text)).toBeTruthy();
  expect(network).not.toHaveBeenCalled();
});

it('reads the count only from cached data when the account menu opens', async () => {
  const { client } = renderHeader({ session: operator });
  const menu = await openAccountMenu();
  expect(within(menu).queryByText(/subscriber/)).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 20));
  const state = client.getQueryState(qk.operatorSnapshot);
  expect(state?.fetchStatus ?? 'idle').toBe('idle');
  expect(state?.errorUpdateCount ?? 0).toBe(0);
});

it('leaves the count out of the account menu when subscriptions are disabled', async () => {
  renderHeader({
    session: operator,
    subscribers: { enabled: false, siteKey: null },
    subscriberCount: 0,
  });
  const menu = await openAccountMenu();
  expect(within(menu).queryByText(/subscriber/)).toBeNull();
});

it('shows operators in visitor view the form', async () => {
  renderHeader({ session: operator, visitorView: true, subscriberCount: 3 });
  const { dialog } = await openForm();
  expect(within(dialog).getByLabelText('Email address')).toBeTruthy();
});
