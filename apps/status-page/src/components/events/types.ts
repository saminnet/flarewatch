import type { Maintenance } from '@flarewatch/shared';

export type IncidentEvent = {
  type: 'incident';
  monitorId: string;
  monitorName: string;
  start: number; // seconds
  end?: number; // seconds
  errors: string[];
};

export type MaintenanceEvent = {
  type: 'maintenance';
  maintenance: Maintenance;
};

export type TimelineEvent = IncidentEvent | MaintenanceEvent;
