import { afterAll, beforeAll } from 'vite-plus/test';
import { unstable_startWorker } from 'wrangler';

/** Outbound requests leave from workerd, not Node. */
export function useDirectWorker() {
  let worker: Awaited<ReturnType<typeof unstable_startWorker>> | undefined;
  beforeAll(async () => {
    worker = await unstable_startWorker({
      config: `${import.meta.dirname}/../workerd/direct/wrangler.toml`,
      dev: { server: { port: 0 }, inspector: false },
    });
  }, 60_000);
  afterAll(async () => {
    await worker?.dispose();
  });
  return {
    async post(path: string, body: unknown): Promise<unknown> {
      if (!worker) throw new Error('the direct worker has not started');
      const response = await worker.fetch(`http://worker${path}`, {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
      });
      return response.json();
    },
  };
}
