import { expect, test as base } from '@playwright/test';
import { isJsonObject } from '@flarewatch/shared';

const ADMIN_AUTH = { Authorization: `Basic ${btoa('e2e-admin:e2e-password')}` };
const CREATES = /\/api\/admin\/(maintenances|announcements)$/;

/** A test that expects a client error takes `clientErrors` and removes the error. */
export const test = base.extend<{ clientErrors: string[]; createdRecords: void }>({
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
  // The servers keep their storage across tests, so a test that fails partway
  // must not leave its maintenance windows or announcements behind.
  createdRecords: [
    async ({ context, request }, use) => {
      const created: { path: string; id: string }[] = [];
      await context.route(CREATES, async (route) => {
        if (route.request().method() !== 'POST') return route.fallback();
        const response = await route.fetch();
        const body: unknown = response.status() === 201 ? await response.json() : null;
        if (isJsonObject(body) && typeof body.id === 'string') {
          created.push({ path: new URL(route.request().url()).pathname, id: body.id });
        }
        await route.fulfill({ response });
      });
      await use();
      for (const { path, id } of created) {
        await request.delete(path, { headers: ADMIN_AUTH, data: { id } });
      }
    },
    { auto: true },
  ],
});
