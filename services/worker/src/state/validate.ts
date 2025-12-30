import { z } from 'zod';
import type { MonitorState } from '@flarewatch/shared';

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
