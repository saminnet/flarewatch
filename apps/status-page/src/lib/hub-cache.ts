import { isHubView, isLatencySamples, type HubView, type LatencySample } from '@flarewatch/shared';
import { initialRunStatus } from '@flarewatch/shared/initial-run';
import { getConfig } from '@/lib/config';
import { fetchHubView, fetchLatency, triggerCheckRun } from '@/lib/monitor-worker';
import { visitorSnapshot, type Snapshot } from '@/lib/public-view';

declare global {
  interface CacheStorage {
    readonly default: Cache;
  }
}

let initialRun: { claimedAt: number; promise: Promise<boolean> } | null = null;

async function triggerInitialCheck(lastUpdate: number): Promise<void> {
  const now = Date.now();
  const { status } = initialRunStatus(lastUpdate, initialRun?.claimedAt, now);
  if (status === 'run-recorded') return;
  if (status === 'no-run') initialRun = { claimedAt: now, promise: triggerCheckRun() };
  await initialRun?.promise;
}

const VIEW_CACHE_MS = 20_000;
const LATENCY_CACHE_MS = 30_000;
const VIEW_CACHE_KEY = 'https://flarewatch-cache.invalid/visitor-view';
const AT_HEADER = 'X-FlareWatch-At';
/** A value and when the hub served it, so a copy from another cache keeps the first deadline. */
type Timed<T> = { atMs: number; value: T };
const cachedLatency = new Map<string, Timed<Promise<LatencySample[]>>>();
const viewWrites = new Set<Promise<void>>();
let viewGeneration = 0;
let cachedView: Timed<Promise<HubView>> | null = null;

async function locationRead<T>(
  key: string,
  valid: (value: unknown) => value is T,
): Promise<Timed<T> | undefined> {
  if (typeof caches === 'undefined') return undefined;
  try {
    const response = await caches.default.match(key);
    const atMs = Number(response?.headers.get(AT_HEADER));
    if (response && Number.isFinite(atMs)) {
      const value: unknown = await response.json();
      if (valid(value)) return { atMs, value };
    }
  } catch (error) {
    console.warn('Location cache read failed:', error);
  }
  return undefined;
}

async function locationWrite(key: string, { atMs, value }: Timed<unknown>, ttlMs: number) {
  if (typeof caches === 'undefined') return;
  try {
    await caches.default.put(
      key,
      Response.json(value, {
        headers: { 'Cache-Control': `max-age=${ttlMs / 1000}`, [AT_HEADER]: String(atMs) },
      }),
    );
  } catch (error) {
    console.warn('Location cache write failed:', error);
  }
}

/** Starts the isolate copy now, then moves its deadline to when the hub served the value. */
function isolateEntry<T>(nowMs: number, read: Promise<Timed<T>>) {
  const entry = { atMs: nowMs, value: read.then(({ value }) => value) };
  void read.then(
    ({ atMs }) => {
      entry.atMs = atMs;
    },
    () => {},
  );
  return entry;
}

async function fetchVisitorView(): Promise<Timed<HubView>> {
  const generation = viewGeneration;
  const cached = await locationRead(VIEW_CACHE_KEY, isHubView);
  if (cached) return cached;
  const atMs = Date.now();
  const view = await fetchHubView();
  const snapshot = visitorSnapshot(getConfig(), view, view.maintenances, view.announcements);
  const filtered = {
    atMs,
    value: {
      lastUpdate: view.lastUpdate,
      monitors: snapshot.state?.monitors ?? {},
      maintenances: snapshot.maintenances,
      announcements: snapshot.announcements,
    },
  };
  if (generation === viewGeneration) {
    const write = locationWrite(VIEW_CACHE_KEY, filtered, VIEW_CACHE_MS);
    viewWrites.add(write);
    await write.finally(() => viewWrites.delete(write));
  }
  return filtered;
}

export async function readLatency(id: string, published: boolean): Promise<LatencySample[]> {
  const now = Date.now();
  for (const [key, entry] of cachedLatency) {
    if (now - entry.atMs >= LATENCY_CACHE_MS) cachedLatency.delete(key);
  }
  const existing = cachedLatency.get(id);
  if (existing) return existing.value;
  const entry = isolateEntry(
    now,
    (async () => {
      const key = `https://flarewatch-cache.invalid/latency/${encodeURIComponent(id)}`;
      if (published) {
        const cached = await locationRead(key, isLatencySamples);
        if (cached) return cached;
      }
      const fetched = { atMs: Date.now(), value: await fetchLatency(id) };
      if (published) await locationWrite(key, fetched, LATENCY_CACHE_MS);
      return fetched;
    })(),
  );
  cachedLatency.set(id, entry);
  void entry.value.catch(() => {
    if (cachedLatency.get(id) === entry) cachedLatency.delete(id);
  });
  return entry.value;
}

/** After an operator edit, so visitors see it without waiting out the caches. */
export async function forgetCachedView(): Promise<void> {
  cachedView = null;
  viewGeneration++;
  await Promise.all(viewWrites);
  if (typeof caches === 'undefined') return;
  try {
    await caches.default.delete(VIEW_CACHE_KEY);
  } catch (error) {
    console.warn('Location cache delete failed:', error);
  }
  // A read during the delete can have restored the old view from the location cache.
  cachedView = null;
}

function readVisitorView(nowMs: number): Promise<HubView> {
  if (!cachedView || nowMs - cachedView.atMs >= VIEW_CACHE_MS) {
    const entry = isolateEntry(nowMs, fetchVisitorView());
    cachedView = entry;
    void entry.value.catch(() => {
      if (cachedView === entry) cachedView = null;
    });
  }
  return cachedView.value;
}

/** Visitors reuse the filtered view for 20s per isolate and Cloudflare location. */
export async function readHubView(fresh: boolean): Promise<HubView> {
  const view = fresh ? await fetchHubView() : await readVisitorView(Date.now());
  // A fresh deployment has no check run yet so start one instead of waiting for the cron.
  await triggerInitialCheck(view.lastUpdate);
  return view;
}

export function logAndFallback<T>(promise: Promise<T>, message: string, fallback: T): Promise<T> {
  return promise.catch((error: unknown) => {
    console.error(message, error);
    return fallback;
  });
}

/** A hub failure degrades to empty data instead of an error page. */
export async function readVisitorSnapshot(): Promise<Snapshot> {
  const view = await logAndFallback(readHubView(false), 'Error fetching monitor state:', null);
  return visitorSnapshot(getConfig(), view, view?.maintenances ?? [], view?.announcements ?? []);
}
