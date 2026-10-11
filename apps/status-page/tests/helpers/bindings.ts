import { vi } from 'vite-plus/test';

type WorkerFetch = (input: string, init?: RequestInit) => Promise<Response>;

export function stubMonitorWorker(fetch: WorkerFetch, extra: Partial<Cloudflare.Env> = {}): void {
  vi.stubGlobal('__env__', { ...extra, MONITOR_WORKER: { fetch } });
}
