import { once } from 'node:events';
import type { Server } from 'node:net';

const HOST = '127.0.0.1';

export async function listen(server: Server): Promise<number> {
  server.listen(0, HOST);
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('server has no port');
  return address.port;
}

export async function close(server: Server & { closeAllConnections?: () => void }): Promise<void> {
  if (!server.listening) return;
  const closed = once(server, 'close');
  server.close();
  server.closeAllConnections?.();
  await closed;
}
