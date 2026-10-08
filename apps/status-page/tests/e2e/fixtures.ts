import { expect, test as base } from '@playwright/test';

/** A test that expects a client error takes `clientErrors` and removes the error. */
export const test = base.extend<{ clientErrors: string[] }>({
  // Playwright reads fixture dependencies from this pattern.
  // oxlint-disable-next-line no-empty-pattern
  clientErrors: async ({}, use) => {
    await use([]);
  },
  context: async ({ context, clientErrors }, use) => {
    context.on('weberror', (error) => clientErrors.push(error.error().message));
    context.on('console', (message) => {
      if (message.type() === 'error') clientErrors.push(message.text());
    });
    await use(context);
    expect(clientErrors, 'console errors and uncaught exceptions').toEqual([]);
  },
});
