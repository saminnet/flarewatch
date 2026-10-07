import {
  DEFAULT_HTTP_TIMEOUT,
  type CheckResultWithLocation,
  failure,
  type Fetcher,
  type MonitorTarget,
  type VpcBinding,
} from '@flarewatch/shared';
import { HttpChecker } from './http';
import { TcpChecker } from './tcp';

const MISSING_BINDING =
  'The VPC binding is missing: add [[vpc_networks]] to services/worker/wrangler.toml';

/** The binding's fetch as the shared fetcher type, so the HTTP checker keeps its timeouts. */
function vpcFetcher(binding: VpcBinding): Fetcher {
  return async (url, options = {}) => {
    const { timeout = DEFAULT_HTTP_TIMEOUT, body, ...rest } = options;
    const init: RequestInit = { ...rest, signal: AbortSignal.timeout(timeout) };
    if (body !== undefined) init.body = body;
    return binding.fetch(url, init);
  };
}

/**
 * Runs one check through the Worker's VPC binding: HTTP methods through the binding's fetch,
 * TCP_PING through its connect. Both follow the direct check's rules, because the check still
 * runs in the Worker. Fails with setup advice when the deployment has no binding.
 */
export async function checkVpc(
  target: MonitorTarget,
  binding: VpcBinding | undefined,
  getEdgeLocation: () => Promise<string>,
): Promise<CheckResultWithLocation> {
  if (!binding) return { location: 'ERROR', result: failure(MISSING_BINDING) };
  const checker =
    target.method === 'TCP_PING'
      ? new TcpChecker((address) => binding.connect(address))
      : new HttpChecker(vpcFetcher(binding));
  return { location: await getEdgeLocation(), result: await checker.check(target) };
}
