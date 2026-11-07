import {
  normalizeAnnouncement,
  readJsonUpTo,
  toStoredAnnouncement,
  toStoredMaintenance,
} from '@flarewatch/shared';
import { getHub, type Env } from '../env';

const MAINTENANCE_PREFIX = '/maintenances/';
const ANNOUNCEMENT_PREFIX = '/announcements/';

/**
 * The hub as the status page reads and edits it over its MONITOR_WORKER
 * binding. Null for any other path. The worker has no public route.
 */
export async function handleHubRequest(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const { method } = request;

  if (pathname.startsWith('/incidents/') && method === 'POST') {
    const id = decodeId(pathname.slice('/incidents/'.length));
    const body = await readJsonUpTo(request, 4096).catch(() => null);
    if (
      !id ||
      !body ||
      typeof body !== 'object' ||
      !('by' in body) ||
      typeof body.by !== 'string' ||
      !body.by.trim() ||
      body.by.length > 200
    )
      return Response.json({ error: 'Invalid acknowledgement' }, { status: 400 });
    return new Response(null, {
      status: (await getHub(env).ackIncident(id, body.by.trim())) ? 204 : 409,
    });
  }
  if (pathname === '/view' && method === 'GET') {
    return Response.json(await getHub(env).view());
  }
  if (pathname === '/maintenances' && method === 'GET') {
    return Response.json(await getHub(env).maintenances());
  }
  if (pathname === '/announcements' && method === 'GET') {
    return Response.json(await getHub(env).announcements());
  }
  if (pathname.startsWith('/latency/') && method === 'GET') {
    const id = decodeId(pathname.slice('/latency/'.length));
    if (id === null) return Response.json({ error: 'Invalid id' }, { status: 400 });
    return Response.json(await getHub(env).latency(id, Math.floor(Date.now() / 1000)));
  }
  if (!pathname.startsWith(MAINTENANCE_PREFIX)) {
    return handleAnnouncement(request, env, pathname, method);
  }

  const id = decodeId(pathname.slice(MAINTENANCE_PREFIX.length));
  if (id === null) return Response.json({ error: 'Invalid id' }, { status: 400 });
  if (method === 'PUT') {
    const maintenance = toStoredMaintenance(
      await readJsonUpTo(request, 64 * 1024).catch(() => null),
    );
    if (!maintenance || maintenance.id !== id) {
      return Response.json({ error: 'Invalid maintenance' }, { status: 400 });
    }
    if (!(await getHub(env).putMaintenance(maintenance))) {
      return Response.json({ error: 'Too many maintenance windows' }, { status: 400 });
    }
    return new Response(null, { status: 204 });
  }
  if (method === 'DELETE') {
    const deleted = await getHub(env).deleteMaintenance(id);
    return new Response(null, { status: deleted ? 204 : 404 });
  }
  return null;
}

async function handleAnnouncement(
  request: Request,
  env: Env,
  pathname: string,
  method: string,
): Promise<Response | null> {
  if (!pathname.startsWith(ANNOUNCEMENT_PREFIX)) return null;

  if (pathname.endsWith('/updates') && method === 'POST') {
    const id = decodeId(pathname.slice(ANNOUNCEMENT_PREFIX.length, -'/updates'.length));
    if (!id) return Response.json({ error: 'Invalid id' }, { status: 400 });
    const input = await readJsonUpTo(request, 16 * 1024).catch(() => null);
    const result = await getHub(env).appendAnnouncementUpdate(id, input);
    if ('error' in result) return Response.json({ error: result.error }, { status: result.status });
    return Response.json(result.announcement);
  }

  const id = decodeId(pathname.slice(ANNOUNCEMENT_PREFIX.length));
  if (id === null) return Response.json({ error: 'Invalid id' }, { status: 400 });
  if (method === 'PUT') {
    const input = await readJsonUpTo(request, 64 * 1024).catch(() => null);
    const announcement = toStoredAnnouncement(input);
    if (!announcement || announcement.id !== id) {
      const result = normalizeAnnouncement(input);
      return Response.json(
        { error: 'error' in result ? result.error : 'Invalid announcement id or timestamps' },
        { status: 400 },
      );
    }
    if (!(await getHub(env).putAnnouncement(announcement))) {
      return Response.json({ error: 'Too many announcements' }, { status: 400 });
    }
    return new Response(null, { status: 204 });
  }
  if (method === 'DELETE') {
    const deleted = await getHub(env).deleteAnnouncement(id);
    return new Response(null, { status: deleted ? 204 : 404 });
  }
  return null;
}

/** A percent-encoded path segment, or null when its encoding is malformed. */
function decodeId(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}
