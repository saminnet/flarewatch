import { QueryClient } from '@tanstack/react-query';
import { QUERY_STALE_TIME } from '@/lib/constants';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: QUERY_STALE_TIME.DEFAULT,
      },
    },
  });
}
