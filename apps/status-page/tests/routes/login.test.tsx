// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRoute,
  createRootRouteWithContext,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vite-plus/test';
import { Route } from '@/routes/login';
import type { Session } from '@/lib/session';

afterEach(cleanup);

it('keeps hook order when sign-in becomes available on the login page', async () => {
  const session: Session = {
    viewer: 'visitor',
    name: null,
    signedInAt: null,
    canSignIn: false,
    passwordSignIn: false,
    providers: [],
    privateOnly: false,
  };
  const root = createRootRouteWithContext<{ session: Session }>()();
  const login = createRoute({
    getParentRoute: () => root,
    path: '/login',
    component: Route.options.component,
    validateSearch: Route.options.validateSearch,
  });
  const router = createRouter({
    routeTree: root.addChildren([login]),
    history: createMemoryHistory({ initialEntries: ['/login?error=denied'] }),
    context: { session },
  });
  await router.load();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Sign-in is not set up')).toBeTruthy();
  await act(async () => {
    router.update({ context: { session: { ...session, canSignIn: true, passwordSignIn: true } } });
    await router.invalidate();
  });
  expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeTruthy();
  expect(screen.getByRole('alert').textContent).toBe(
    'This account is not allowed to sign in here.',
  );
});
