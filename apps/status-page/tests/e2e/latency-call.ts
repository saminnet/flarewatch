import { expect, type Page, type Request } from '@playwright/test';

export async function captureLatencyCall(
  page: Page,
  monitorId: string,
  rowName: RegExp,
): Promise<Request> {
  let captured: Request | undefined;
  // A click before hydration loads the whole page, so retry until the client-side call fires.
  await expect(async () => {
    await page.goto('/');
    // TanStack gives the server function a build-specific URL, so match it by path and id.
    const call = page.waitForRequest(
      (request) =>
        request.method() === 'GET' &&
        request.url().includes('/_serverFn/') &&
        request.url().includes(monitorId),
      { timeout: 2_000 },
    );
    await page.getByRole('link', { name: rowName }).click();
    captured = await call;
  }).toPass({ timeout: 20_000 });
  if (!captured) throw new Error('no latency server-fn call captured');
  return captured;
}
