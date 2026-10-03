import {
  type MonitorTarget,
  type CheckResult,
  type MonitorChecker,
  success,
  failure,
  withTimeout,
  parseTcpTarget,
  DEFAULT_HTTP_TIMEOUT,
  createLogger,
  getErrorMessage,
  publicErrorMessage,
  isTimeoutError,
} from '@flarewatch/shared';

const log = createLogger('TCP');

type Connect = (address: {
  hostname: string;
  port: number;
}) => Promise<{ opened: Promise<unknown>; close(): Promise<void> }>;

async function connectSocket(address: { hostname: string; port: number }) {
  // Avoids a cloudflare:sockets bundling issue.
  const { connect } = await import(/* webpackIgnore: true */ 'cloudflare:sockets');
  return connect(address);
}

export class TcpChecker implements MonitorChecker {
  constructor(private readonly connect: Connect = connectSocket) {}

  async check(target: MonitorTarget): Promise<CheckResult> {
    const startTime = performance.now();
    const timeout = target.timeout ?? DEFAULT_HTTP_TIMEOUT;

    try {
      const { hostname, port } = parseTcpTarget(target.target);
      const socket = await this.connect({ hostname, port });

      try {
        await withTimeout(socket.opened, timeout);
      } finally {
        await socket.close().catch(() => {});
      }

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
      return failure(publicErrorMessage(errorMessage), latency);
    }
  }
}

export const tcpChecker = new TcpChecker();
