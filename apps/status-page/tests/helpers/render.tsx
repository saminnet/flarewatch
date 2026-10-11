import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider, type QueryClientConfig } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from '@tanstack/react-router';
import { render } from '@testing-library/react';
import { afterEach } from 'vite-plus/test';

const clients: QueryClient[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.clear();
});

/** A query client cleared after the test that made it, so no cache timer outlives the test. */
export function createTestQueryClient(config?: QueryClientConfig): QueryClient {
  const client = new QueryClient(config);
  clients.push(client);
  return client;
}

/** `ui` inside the query and router contexts the app's hooks read. */
export function withProviders(ui: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute(),
    history: createMemoryHistory(),
  });
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <RouterContextProvider router={router}>{ui}</RouterContextProvider>
    </QueryClientProvider>
  );
}

export function renderWithProviders(ui: ReactNode) {
  return render(withProviders(ui));
}
