import { createServerFn } from '@tanstack/react-start';
import { getConfig, isPrivateOnly } from '@/lib/config';
import { readVisitorSnapshot } from '@/lib/hub-cache';
import { getPrincipal } from '@/lib/operator.server';
import {
  readMemberSnapshot,
  readMonitorLatency,
  readOperatorSnapshot,
} from '@/lib/snapshot-reads.server';

/** A private-only page serves the visitor snapshot only to someone signed in, for their Visitor view. */
export const getVisitorSnapshot = createServerFn({ method: 'GET' }).handler(async () => {
  if (isPrivateOnly(getConfig()) && !(await getPrincipal())) {
    throw new Error('Not authenticated');
  }
  return readVisitorSnapshot();
});

export const getOperatorSnapshot = createServerFn({ method: 'GET' }).handler(readOperatorSnapshot);

export const getMemberSnapshot = createServerFn({ method: 'GET' }).handler(readMemberSnapshot);

export const getMonitorLatency = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(({ data }) => readMonitorLatency(data.id));
