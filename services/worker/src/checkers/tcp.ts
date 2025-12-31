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
  isTimeoutError,
} from '@flarewatch/shared';

const log = createLogger('TCP');

export class TcpChecker implements MonitorChecker {
  async check(target: MonitorTarget): Promise<CheckResult> {
    const startTime = performance.now();
    const timeout = target.timeout ?? DEFAULT_HTTP_TIMEOUT;

    try {
      const { hostname, port } = parseTcpTarget(target.target);

      // Dynamic import to avoid bundling issues
      const { connect } = await import(/* webpackIgnore: true */ 'cloudflare:sockets');

      // Create socket connection
      const socket = connect({
        hostname,
        port,
      });

      // Wait for connection with timeout
      await withTimeout(socket.opened, timeout);

      // Connection successful, close it
      await socket.close();

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
}

/** Singleton instance */
export const tcpChecker = new TcpChecker();
