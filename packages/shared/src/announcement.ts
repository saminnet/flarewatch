import type { Announcement, AnnouncementConfig } from './types';
import { isJsonObject, isNonEmptyString } from './utils';

export type NormalizedAnnouncement = { title: string; body: string; end?: string };

type Normalized = { value: NormalizedAnnouncement } | { error: string };

function parseTime(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

export function isAnnouncementActive(announcement: AnnouncementConfig, now: number): boolean {
  return announcement.end === undefined || new Date(announcement.end).getTime() > now;
}

export function normalizeAnnouncement(input: unknown, { capped = true } = {}): Normalized {
  if (!isJsonObject(input)) return { error: 'An announcement must be an object' };

  if (typeof input.body !== 'string') return { error: 'Body must be text' };
  const body = input.body.trim();
  if (!body) return { error: 'Body must not be empty' };

  if (typeof input.title !== 'string') return { error: 'Title must be text' };
  const title = input.title.trim();
  if (!title) return { error: 'Title must not be empty' };

  const end = input.end === undefined ? undefined : parseTime(input.end);
  if (input.end !== undefined && end === undefined) return { error: 'End must be a date' };

  const value = {
    title,
    body,
    ...(end !== undefined && { end: new Date(end).toISOString() }),
  };
  if (capped && body.length > 2000) return { error: 'Body must be at most 2000 characters' };
  if (capped && title.length > 200) {
    return { error: 'Title must be at most 200 characters' };
  }
  return { value };
}

export function toStoredAnnouncement(value: unknown, { capped = true } = {}): Announcement | null {
  if (!isJsonObject(value) || !isNonEmptyString(value.id)) return null;
  const { createdAt, updatedAt } = value;
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null;
  if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt)) return null;
  const result = normalizeAnnouncement(value, { capped });
  if ('error' in result) return null;
  return { ...result.value, id: value.id, createdAt, updatedAt };
}

export function isValidAnnouncement(value: unknown): value is Announcement {
  return toStoredAnnouncement(value, { capped: false }) !== null;
}

export function parseAnnouncements(value: unknown): Announcement[] {
  return Array.isArray(value) ? value.filter(isValidAnnouncement) : [];
}
