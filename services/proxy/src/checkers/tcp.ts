import { createLogger } from '../log';
import type { CheckResult, MonitorTarget } from '../types';
import {
  DEFAULT_HTTP_TIMEOUT,
  failure,
  getErrorMessage,
  isTimeoutError,
  parseTcpTarget,
  success,
} from '../utils';

const log = createLogger('TCP');

export async function checkTcp(target: MonitorTarget): Promise<CheckResult> {
  const startTime = performance.now();
  const timeout = target.timeout ?? DEFAULT_HTTP_TIMEOUT;

  try {
    const { hostname, port } = parseTcpTarget(target.target);

    // Dynamic import for Node.js net module
    const net = await import('node:net').catch(() => null);

    if (!net) {
      return failure('TCP checks require Node.js runtime (net module not available)');
    }

    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: hostname, port });

      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error(`Connection timed out after ${timeout}ms`));
      }, timeout);

      socket.on('connect', () => {
        clearTimeout(timer);
        socket.end();
        resolve();
      });

      socket.on('error', (err) => {
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      });
    });

    const latency = Math.round(performance.now() - startTime);
    log.info('Connected', { name: target.name, hostname, port, latency });

    return success(latency);
  } catch (error) {
    const latency = Math.round(performance.now() - startTime);
    const errorMessage = getErrorMessage(error);

    if (isTimeoutError(errorMessage)) {
      log.info('Timeout', { name: target.name, timeout });
      return failure(`Timeout after ${timeout}ms`, latency);
    }

    log.info('Error', { name: target.name, error: errorMessage });
    return failure(errorMessage, latency);
  }
}
