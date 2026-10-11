import { vi } from 'vite-plus/test';

type WorkerFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The env for one test: the MONITOR_WORKER binding answering with `fetch`, and `extra`. */
export function stubMonitorWorker(fetch: WorkerFetch, extra: Partial<Cloudflare.Env> = {}): void {
  vi.stubGlobal('__env__', { ...extra, MONITOR_WORKER: { fetch } });
}
