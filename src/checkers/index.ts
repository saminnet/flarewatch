import { createLogger } from '../log';
import type { CheckResult, MonitorTarget } from '../types';
import { failure, getErrorMessage } from '../utils';
import { checkHttp } from './http';
import { checkTcp } from './tcp';

const log = createLogger('Checker');

/**
 * Check a monitor target
 * Dispatches to appropriate checker based on method
 */
export async function checkMonitor(target: MonitorTarget): Promise<CheckResult> {
  try {
    switch (target.method) {
      case 'TCP_PING':
        return await checkTcp(target);

      case 'GET':
      case 'POST':
      case 'PUT':
      case 'DELETE':
      case 'HEAD':
      case 'OPTIONS':
      case 'PATCH':
        return await checkHttp(target);

      default:
        // Default to HTTP for unknown methods
        log.info('Unknown method, defaulting to HTTP', { method: target.method });
        return await checkHttp(target);
    }
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    log.error('Unexpected error', { name: target.name, error: errorMessage });
    return failure(`Unexpected error: ${errorMessage}`);
  }
}
