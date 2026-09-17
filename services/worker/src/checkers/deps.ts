import {
  fetchWithTimeout,
  type CheckResultWithLocation,
  type Fetcher,
  type MonitorChecker,
  type MonitorTarget,
} from '@flarewatch/shared';
import { getEdgeLocation } from '../utils/location';
import { httpChecker } from './http';
import { tcpChecker } from './tcp';
import { globalPingChecker } from './globalping';

/** GlobalPing reports the probe's own location, so it does not implement `MonitorChecker`. */
interface LocatedChecker {
  check(target: MonitorTarget): Promise<CheckResultWithLocation>;
}

/**
 * The collaborators a check dispatch needs. Production passes {@link defaultCheckDeps}; tests
 * substitute a checker or a fixed edge location without reaching for module mocking.
 */
export interface CheckDeps {
  readonly http: MonitorChecker;
  readonly tcp: MonitorChecker;
  readonly globalPing: LocatedChecker;
  readonly getEdgeLocation: () => Promise<string>;
  /** Used by the external-proxy path, which calls a plain function rather than a checker. */
  readonly fetcher: Fetcher;
}

export const defaultCheckDeps: CheckDeps = {
  http: httpChecker,
  tcp: tcpChecker,
  globalPing: globalPingChecker,
  getEdgeLocation,
  fetcher: fetchWithTimeout,
};
