import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';

/** `ui` inside the query and router contexts the app's hooks read. */
export function withProviders(ui: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory(),
  });
  return (
    <QueryClientProvider client={new QueryClient()}>
      <RouterContextProvider router={router}>{ui}</RouterContextProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: ReactNode) {
  return render(withProviders(ui));
}
