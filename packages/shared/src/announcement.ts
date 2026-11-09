import type { Announcement, AnnouncementConfig, AnnouncementUpdate, IncidentStatus } from './types';
import { parseTime } from './maintenance';
import { isJsonObject, isNonEmptyString } from './utils';

export type NormalizedAnnouncement = Omit<AnnouncementConfig, 'end'> & { end?: string };

export const MAX_ANNOUNCEMENT_UPDATES = 20;
export const MAX_ANNOUNCEMENT_TEXT = 2000;

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;

export function isIncidentStatus(value: unknown): value is IncidentStatus {
  return INCIDENT_STATUSES.some((status) => status === value);
}

type Normalized = { value: NormalizedAnnouncement } | { error: string };

export function isAnnouncementActive(announcement: AnnouncementConfig, now: number): boolean {
  return announcement.end === undefined || new Date(announcement.end).getTime() > now;
}

/** `visitor` reads a visitor's copy, whose updates must carry no responder. */
export function normalizeAnnouncement(
  input: unknown,
  { capped = true, visitor = false } = {},
): Normalized {
  if (!isJsonObject(input)) return { error: 'An announcement must be an object' };

  if (typeof input.body !== 'string') return { error: 'Body must be text' };
  const body = input.body.trim();
  if (!body) return { error: 'Body must not be empty' };

  if (typeof input.title !== 'string') return { error: 'Title must be text' };
  const title = input.title.trim();
  if (!title) return { error: 'Title must not be empty' };

  const end = input.end === undefined ? undefined : parseTime(input.end);
  if (input.end !== undefined && end === undefined) return { error: 'End must be a date' };

  if (capped && body.length > MAX_ANNOUNCEMENT_TEXT)
    return { error: `Body must be at most ${MAX_ANNOUNCEMENT_TEXT} characters` };
  if (capped && title.length > 200) return { error: 'Title must be at most 200 characters' };

  const kind = input.kind === undefined ? 'notice' : input.kind;
  if (kind !== 'notice' && kind !== 'incident') return { error: 'Invalid kind' };
  if (
    input.monitors !== undefined &&
    (!Array.isArray(input.monitors) || !input.monitors.every(isNonEmptyString))
  )
    return { error: 'Invalid monitors' };
  const monitors = Array.isArray(input.monitors)
    ? [...new Set(input.monitors.filter(isNonEmptyString))]
    : undefined;
  if (kind === 'notice' && (input.status !== undefined || input.updates !== undefined))
    return { error: 'Status and updates require an incident' };
  const status =
    kind === 'incident' ? (input.status === undefined ? 'investigating' : input.status) : undefined;
  if (status !== undefined && !isIncidentStatus(status)) return { error: 'Invalid status' };
  const updates: AnnouncementUpdate[] = [];
  if (input.updates !== undefined) {
    if (!Array.isArray(input.updates) || input.updates.length > MAX_ANNOUNCEMENT_UPDATES)
      return { error: `Updates must contain at most ${MAX_ANNOUNCEMENT_UPDATES} entries` };
    for (const update of input.updates) {
      const text = isJsonObject(update) && isNonEmptyString(update.body) ? update.body.trim() : '';
      const by = isJsonObject(update) && isNonEmptyString(update.by) ? update.by.trim() : '';
      if (
        !isJsonObject(update) ||
        !isIncidentStatus(update.status) ||
        !text ||
        text.length > MAX_ANNOUNCEMENT_TEXT ||
        (visitor ? update.by !== undefined : !by) ||
        typeof update.at !== 'string'
      )
        return {
          error: visitor
            ? 'Invalid update: a visitor copy has status and body, and no responder'
            : `Invalid update: status, body (at most ${MAX_ANNOUNCEMENT_TEXT} characters) and responder are required`,
        };
      const at = parseTime(update.at);
      if (
        at === undefined ||
        (updates.length > 0 && at < Date.parse(updates[updates.length - 1]!.at))
      )
        return { error: 'Update dates must be oldest first' };
      updates.push({
        at: new Date(at).toISOString(),
        status: update.status,
        body: text,
        ...(!visitor && { by }),
      });
    }
  }

  const value: NormalizedAnnouncement = {
    kind,
    ...(monitors !== undefined && { monitors }),
    ...(status !== undefined && { status: updates.at(-1)?.status ?? status }),
    ...(kind === 'incident' && { updates }),
    title,
    body,
    ...(end !== undefined && { end: new Date(end).toISOString() }),
  };
  return { value };
}

export function toStoredAnnouncement(
  value: unknown,
  { capped = true, visitor = false } = {},
): Announcement | null {
  if (!isJsonObject(value) || !isNonEmptyString(value.id)) return null;
  const { createdAt, updatedAt } = value;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;
  const result = normalizeAnnouncement(value, { capped, visitor });
  if ('error' in result) return null;
  return { ...result.value, id: value.id, createdAt, updatedAt };
}

export function isValidAnnouncement(value: unknown): value is Announcement {
  return toStoredAnnouncement(value, { capped: false }) !== null;
}

export function isVisitorAnnouncement(value: unknown): value is Announcement {
  return toStoredAnnouncement(value, { capped: false, visitor: true }) !== null;
}

export function parseAnnouncements(value: unknown): Announcement[] {
  return Array.isArray(value) ? value.filter(isValidAnnouncement) : [];
}
