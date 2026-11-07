import type { Incident, Maintenance, Occurrence } from '@flarewatch/shared';

export type IncidentEvent = {
  type: 'incident';
  monitorId: string;
  monitorName: string;
  start: number; // seconds
  end?: number; // seconds
  errors: string[];
  incident: Incident;
};

export type MaintenanceEvent = {
  type: 'maintenance';
  maintenance: Maintenance;
  occurrence: Occurrence;
};

export type TimelineEvent = IncidentEvent | MaintenanceEvent;
