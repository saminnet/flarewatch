import { describe, it, expect } from 'vite-plus/test';
import { validateHttpResponse } from '../src/utils';
import type { MonitorTarget } from '../src/types';
import fixture from './fixtures/http-assertions.json';

/** flarewatch-proxy runs the same file, so this shape is a contract between the repos. */
interface Case {
  name: string;
  monitor: Partial<MonitorTarget>;
  reply: { status: number; headers: Record<string, string>; body: string };
  error: string | null;
}

describe('http-assertions.json', () => {
  it.each(fixture as Case[])('$name', async ({ monitor, reply, error }) => {
    const target: MonitorTarget = {
      id: 'test',
      name: 'Test',
      method: 'GET',
      target: 'https://example.com',
      ...monitor,
    };
    await expect(
      validateHttpResponse(target, { ...reply, headers: new Headers(reply.headers) }),
    ).resolves.toBe(error);
  });
});
