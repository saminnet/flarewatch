import { useState } from 'react';
import { IconCircleCheck, IconCircleX, IconRefresh } from '@tabler/icons-react';
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
  const [isPending, setIsPending] = useState(false);
  const [result, setResult] = useState<CheckResultWithLocation | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    setIsPending(true);
    setResult(null);
    setError(null);
    try {
      setResult(await requestCheckNow(monitorId));
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    }
    setIsPending(false);
  }

  return (
    <div className="mt-3 text-sm">
      <Button
        variant="outline"
        size="sm"
        disabled={isPending}
        aria-busy={isPending}
        onClick={() => void check()}
      >
        <IconRefresh
          data-icon="inline-start"
          aria-hidden="true"
          className={cn('size-4', isPending && 'animate-spin')}
        />
        Check now
      </Button>
      <div role="status" aria-label="Check now result">
        {isPending && <p className="mt-2 text-xs text-muted-foreground">Checking...</p>}
        {result && <CheckNowResult check={result} />}
        {error !== null && (
          <p className="mt-2 text-xs text-status-down-text wrap-break-word">{error}</p>
        )}
      </div>
    </div>
  );
}

function CheckNowResult({ check: { location, result } }: { check: CheckResultWithLocation }) {
  const coloLabel = formatColoLabel(location);
  const Icon = result.ok ? IconCircleCheck : IconCircleX;
  return (
    <div className="mt-2 w-fit max-w-full rounded-md border border-border bg-muted/40 px-2.5 py-2">
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <Icon
          aria-hidden="true"
          className={cn(
            'size-4 shrink-0',
            result.ok ? 'text-status-operational-text' : 'text-status-down-text',
          )}
        />
        <span className="font-medium text-foreground">{result.ok ? 'Up' : 'Down'}</span>
        {result.latency !== undefined && (
          <span className="font-medium tabular-nums text-foreground">{`${result.latency}ms`}</span>
        )}
        <span className="text-muted-foreground">
          {`from ${location}${coloLabel ? ` (${coloLabel})` : ''}`}
        </span>
      </p>
      {!result.ok && result.error && (
        <p className="mt-1 pl-5.5 text-xs text-status-down-text wrap-break-word">{result.error}</p>
      )}
    </div>
  );
}
