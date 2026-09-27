import { isValidMaintenance } from '@flarewatch/shared';
import { getHub, type Env } from '../env';

const MAINTENANCE_PREFIX = '/maintenances/';

/**
 * The hub as the status page reads and edits it over its MONITOR_WORKER
 * binding. Null for any other path. The worker has no public route.
 */
export async function handleHubRequest(request: Request, env: Env): Promise<Response | null> {
  const { pathname } = new URL(request.url);
  const { method } = request;

  if (pathname === '/view' && method === 'GET') {
    return Response.json(await getHub(env).view());
  }
  if (pathname.startsWith('/latency/') && method === 'GET') {
    const id = decodeURIComponent(pathname.slice('/latency/'.length));
    return Response.json(await getHub(env).latency(id));
  }
  if (!pathname.startsWith(MAINTENANCE_PREFIX)) return null;

  const id = decodeURIComponent(pathname.slice(MAINTENANCE_PREFIX.length));
  if (method === 'PUT') {
    const maintenance: unknown = await request.json().catch(() => null);
    if (!isValidMaintenance(maintenance) || maintenance.id !== id) {
      return Response.json({ error: 'Invalid maintenance' }, { status: 400 });
    }
    await getHub(env).putMaintenance(maintenance);
    return new Response(null, { status: 204 });
  }
  if (method === 'DELETE') {
    const deleted = await getHub(env).deleteMaintenance(id);
    return new Response(null, { status: deleted ? 204 : 404 });
  }
  return null;
}
