import { z } from 'zod';
import type { MonitorState, Maintenance } from '@flarewatch/shared';

const MaintenanceSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  start: z.union([z.string(), z.number()]),
  end: z.union([z.string(), z.number()]).optional(),
  monitors: z.array(z.string()).optional(),
  title: z.string().optional(),
  color: z.string().optional(),
});

export function parseMaintenances(value: unknown): Maintenance[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Maintenance => MaintenanceSchema.safeParse(item).success);
}

const IncidentSchema = z.object({
  start: z.array(z.number()),
  end: z.number().optional(),
  error: z.array(z.string()),
});

const LatencyPointSchema = z.object({
  loc: z.string(),
  ping: z.number(),
  time: z.number(),
});

const SslCertificateSchema = z.object({
  expiryDate: z.number(),
  daysUntilExpiry: z.number(),
  lastCheck: z.number(),
  issuer: z.string().optional(),
  subject: z.string().optional(),
});

const MonitorStateSchema = z.object({
  lastUpdate: z.number(),
  overallUp: z.number(),
  overallDown: z.number(),
  startedAt: z.record(z.string(), z.number()),
  incident: z.record(z.string(), z.array(IncidentSchema)),
  latency: z.record(z.string(), z.object({ recent: z.array(LatencyPointSchema) })),
  sslCertificates: z.record(z.string(), SslCertificateSchema).optional(),
});

export function isMonitorState(value: unknown): value is MonitorState {
  return MonitorStateSchema.safeParse(value).success;
}
