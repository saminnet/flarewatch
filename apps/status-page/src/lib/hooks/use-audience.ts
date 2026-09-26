import { getRouteApi } from '@tanstack/react-router';
import { audienceOf } from '@/lib/session';
import type { Viewer } from '@/lib/operator.server';

const rootRoute = getRouteApi('__root__');

export function useAudience(): Viewer {
  const { session } = rootRoute.useRouteContext();
  const { view } = rootRoute.useSearch();
  return audienceOf(session, view);
}
