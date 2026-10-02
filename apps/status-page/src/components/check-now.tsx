import { useMutation } from '@tanstack/react-query';
import { IconRefresh } from '@tabler/icons-react';
import type { CheckResultWithLocation } from '@flarewatch/shared';
import { Button } from '@/components/ui/button';
import { requestCheckNow } from '@/lib/check-now';
import { formatColoLabel } from '@/lib/cf-colos';
import { cn } from '@/lib/utils';

interface CheckNowProps {
  monitorId: string;
}

/** Operator only. The result stays in this component: the hub records nothing for it. */
export function CheckNow({ monitorId }: CheckNowProps) {
  const check = useMutation({ mutationFn: () => requestCheckNow(monitorId) });

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <Button variant="outline" size="sm" disabled={check.isPending} onClick={() => check.mutate()}>
        <IconRefresh
          aria-hidden="true"
          className={cn('size-4', check.isPending && 'animate-spin')}
        />
        Check now
      </Button>
      <div
        role="status"
        aria-label="Check now result"
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"
      >
        {check.isSuccess && <CheckNowResult check={check.data} />}
        {check.isError && <span className="text-status-down-text">{check.error.message}</span>}
      </div>
    </div>
  );
}

function CheckNowResult({ check: { location, result } }: { check: CheckResultWithLocation }) {
  const coloLabel = formatColoLabel(location);
  return (
    <>
      <span
        className={cn(
          'font-medium',
          result.ok ? 'text-status-operational' : 'text-status-down-text',
        )}
      >
        {result.ok ? 'Up' : 'Down'}
      </span>
      {result.latency !== undefined && <span className="font-mono">{`${result.latency} ms`}</span>}
      <span className="text-muted-foreground">
        {`from ${location}${coloLabel ? ` (${coloLabel})` : ''}`}
      </span>
      {!result.ok && <span className="break-words text-foreground">{result.error}</span>}
    </>
  );
}
