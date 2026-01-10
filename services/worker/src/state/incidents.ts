import type {
  MonitorState,
  MonitorTarget,
  CheckResult,
  SSLCertificateInfo,
} from '@flarewatch/shared';

const INCIDENT_RETENTION_SECONDS = 90 * 24 * 60 * 60; // 90 days
const LATENCY_RETENTION_SECONDS = 12 * 60 * 60; // 12 hours

export interface IncidentUpdate {
  statusChanged: boolean;
  changeType: 'none' | 'up' | 'down' | 'error';
  isUp: boolean;
  incidentStartTime: number;
  error: string;
}

function ensureMonitorState(state: MonitorState, monitorId: string, currentTime: number): void {
  if (!state.startedAt[monitorId]) {
    state.startedAt[monitorId] = currentTime;
  }

  state.incident[monitorId] ??= [];
  state.latency[monitorId] ??= { recent: [] };
}

export function processCheckResult(
  state: MonitorState,
  monitor: MonitorTarget,
  result: CheckResult,
  currentTime: number,
): IncidentUpdate {
  ensureMonitorState(state, monitor.id, currentTime);

  const incidents = state.incident[monitor.id];
  if (!incidents) {
    return {
      statusChanged: false,
      changeType: 'none',
      isUp: result.ok,
      incidentStartTime: currentTime,
      error: result.ok ? '' : result.error,
    };
  }

  const lastIncident = incidents.length > 0 ? incidents[incidents.length - 1] : undefined;
  let statusChanged = false;
  let changeType: IncidentUpdate['changeType'] = 'none';

  if (result.ok) {
    state.overallUp++;

    if (lastIncident && lastIncident.end === undefined) {
      lastIncident.end = currentTime;
      statusChanged = true;
      changeType = 'up';
    }

    const incidentStart = lastIncident?.start[0];
    return {
      statusChanged,
      changeType,
      isUp: true,
      incidentStartTime: incidentStart ?? currentTime,
      error: '',
    };
  } else {
    state.overallDown++;

    if (!lastIncident || lastIncident.end !== undefined) {
      incidents.push({
        start: [currentTime],
        end: undefined,
        error: [result.error],
      });
      statusChanged = true;
      changeType = 'down';
    } else {
      const lastError = lastIncident.error[lastIncident.error.length - 1];
      if (lastError !== result.error) {
        lastIncident.start.push(currentTime);
        lastIncident.error.push(result.error);
        statusChanged = true;
        changeType = 'error';
      }
    }

    const currentIncident = incidents[incidents.length - 1];
    const incidentStart = currentIncident?.start[0];
    return {
      statusChanged,
      changeType,
      isUp: false,
      incidentStartTime: incidentStart ?? currentTime,
      error: result.error,
    };
  }
}

export function updateLatency(
  state: MonitorState,
  monitorId: string,
  location: string,
  latency: number,
  currentTime: number,
): void {
  const latencyData = state.latency[monitorId];
  if (!latencyData) return;

  latencyData.recent.push({
    loc: location,
    ping: latency,
    time: currentTime,
  });

  const cutoff = currentTime - LATENCY_RETENTION_SECONDS;
  let firstRecord = latencyData.recent[0];
  while (firstRecord && firstRecord.time < cutoff) {
    latencyData.recent.shift();
    firstRecord = latencyData.recent[0];
  }
}

export function updateSSLCertificate(
  state: MonitorState,
  monitorId: string,
  ssl: SSLCertificateInfo,
  currentTime: number,
): void {
  if (!state.sslCertificates) {
    state.sslCertificates = {};
  }

  state.sslCertificates[monitorId] = {
    expiryDate: ssl.expiryDate,
    daysUntilExpiry: ssl.daysUntilExpiry,
    lastCheck: currentTime,
    ...(ssl.issuer && { issuer: ssl.issuer }),
    ...(ssl.subject && { subject: ssl.subject }),
  };
}

export function cleanupOldIncidents(
  state: MonitorState,
  monitorId: string,
  currentTime: number,
): void {
  const incidents = state.incident[monitorId];
  if (!incidents) return;

  const cutoff = currentTime - INCIDENT_RETENTION_SECONDS;

  let first = incidents[0];
  while (first && first.end !== undefined && first.end < cutoff) {
    incidents.shift();
    first = incidents[0];
  }
}

export function createInitialState(): MonitorState {
  return {
    lastUpdate: 0,
    overallUp: 0,
    overallDown: 0,
    startedAt: {},
    incident: {},
    latency: {},
  };
}

export function resetCounters(state: MonitorState): void {
  state.overallUp = 0;
  state.overallDown = 0;
}
