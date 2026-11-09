import type { LatencySample } from '@flarewatch/shared';
import { getConfig, isPrivateOnly } from '@/lib/config';
import { logAndFallback, readHubView, readLatency } from '@/lib/hub-cache';
import { fetchSubscriberCount } from '@/lib/monitor-worker';
import { getPrincipal, requireMember, requireOperator } from '@/lib/operator.server';
import { canReadLatency, memberSnapshot, operatorSnapshot, type Snapshot } from '@/lib/public-view';

/** Includes private monitors, their raw failure messages, and every maintenance window. */
export async function readOperatorSnapshot(): Promise<Snapshot> {
  await requireOperator();
  const view = await readHubView(true);
  const snapshot = operatorSnapshot(getConfig(), view, view.maintenances, view.announcements);
  if (getConfig().statusPage?.subscribers) snapshot.subscriberCount = await fetchSubscriberCount();
  return snapshot;
}

export async function readMemberSnapshot(): Promise<Snapshot> {
  const principal = await requireMember();
  const view = await readHubView(true);
  return memberSnapshot(getConfig(), view, view.maintenances, principal, view.announcements);
}

/**
 * One monitor's latency, for whoever may see that monitor. Anything else gets
 * an empty list, so the answer does not reveal that a hidden monitor exists.
 */
export async function readMonitorLatency(id: string): Promise<LatencySample[]> {
  const config = getConfig();
  const principal = await getPrincipal();
  if (!principal && isPrivateOnly(config)) return [];
  if (!canReadLatency(config, id, principal)) return [];
  return logAndFallback(
    readLatency(id, canReadLatency(config, id, null)),
    'Error fetching latency:',
    [],
  );
}
