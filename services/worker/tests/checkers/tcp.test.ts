import { describe, expect, it, vi } from 'vite-plus/test';
import { TcpChecker } from '../../src/checkers/tcp';

describe('TcpChecker', () => {
  it('closes a socket that does not open in time', async () => {
    const close = vi.fn(async () => {});
    const checker = new TcpChecker(async () => ({ opened: new Promise(() => {}), close }));

    const result = await checker.check({
      id: 'db',
      name: 'Database',
      method: 'TCP_PING',
      target: 'db.example.com:5432',
      timeout: 10,
    });

    expect(result).toMatchObject({ ok: false, error: 'Timeout after 10ms' });
    expect(close).toHaveBeenCalled();
  });

  it('shows a connection failure the runtime does not explain as "Connection failed"', async () => {
    const checker = new TcpChecker(async () => {
      throw new Error('internal error; reference = af8u8m9eap4vgpst8jm117i3');
    });

    const result = await checker.check({
      id: 'db',
      name: 'Database',
      method: 'TCP_PING',
      target: 'db.example.com:5432',
    });

    expect(result).toMatchObject({ ok: false, error: 'Connection failed' });
  });
});
