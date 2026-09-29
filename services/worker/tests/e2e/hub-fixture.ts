import type { HeartbeatState, Incident, LatencySample, Maintenance } from '@flarewatch/shared';

/** What the browser tests start the hub with, keyed by monitor id. */
export type HubFixture = {
  lastUpdate: number;
  startedAt: Record<string, number>;
  incidents: Record<string, Incident[]>;
  latency: Record<string, LatencySample[]>;
  heartbeats: Record<string, HeartbeatState>;
  maintenances: Maintenance[];
};
