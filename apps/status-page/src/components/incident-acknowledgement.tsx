import { useId } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { IconCheck } from '@tabler/icons-react';
import type { Incident } from '@flarewatch/shared';
import { Button } from '@/components/ui/button';
import { formatDuration } from '@/lib/date';
import { mutationErrorMessage } from '@/lib/query/auth.mutations';
import { qk } from '@/lib/query/keys';
import { requestOk, reportError } from '@/lib/query/request';

function acknowledgedWhen(incident: Incident, ackedAt: number, nowMs: number): string {
  const ackedMs = ackedAt * 1000;
  if (incident.end !== undefined) {
    return `after ${formatDuration(ackedMs - (incident.start[0] ?? ackedAt) * 1000)}`;
  }
  const ageMs = nowMs - ackedMs;
  return ageMs < 60_000 ? 'just now' : `${formatDuration(ageMs, { minUnit: 'minutes' })} ago`;
}

function focusOnMount(node: HTMLElement | null) {
  node?.focus();
}

/** The time comes before the responder, so a clamped line cuts the name and never the time. */
export function AcknowledgedStatus({
  incident,
  nowMs,
  operator = false,
  compact = false,
  focus = false,
}: {
  incident: Incident;
  nowMs: number;
  operator?: boolean;
  compact?: boolean;
  focus?: boolean;
}) {
  if (incident.acked_at === undefined) return null;
  const responder = operator ? incident.acked_by : undefined;
  const text = (
    <>
      Acknowledged{' '}
      <time
        className="whitespace-nowrap"
        dateTime={new Date(incident.acked_at * 1000).toISOString()}
      >
        {acknowledgedWhen(incident, incident.acked_at, nowMs)}
      </time>
      {responder && (
        <>
          {' by '}
          <bdi>{responder}</bdi>
        </>
      )}
    </>
  );
  if (compact) {
    return (
      <p className="mt-0.5 line-clamp-2 text-xs wrap-break-word text-muted-foreground">{text}</p>
    );
  }
  return (
    <p
      ref={focus ? focusOnMount : undefined}
      tabIndex={focus ? -1 : undefined}
      className="flex w-fit items-start gap-1 text-xs text-foreground/70"
    >
      <IconCheck aria-hidden="true" className="mt-px size-3.5 shrink-0" />
      <span className="min-w-0 wrap-break-word">{text}</span>
    </p>
  );
}

export function IncidentAcknowledgement({
  incident,
  monitorId,
  monitorName,
  nowMs,
  operator = false,
}: {
  incident: Incident;
  monitorId: string;
  monitorName: string;
  nowMs: number;
  operator?: boolean;
}) {
  const hintId = useId();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      await requestOk('/api/admin/ack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: monitorId }),
      });
    },
    onError: (error) => reportError(client, error),
    // On a 409 the refetch shows who acknowledged it first, or that the incident ended.
    onSettled: () => client.invalidateQueries({ queryKey: qk.snapshot }),
  });

  if (incident.acked_at !== undefined) {
    return (
      <div className="mt-2">
        <AcknowledgedStatus
          incident={incident}
          nowMs={nowMs}
          operator={operator}
          focus={mutation.isSuccess}
        />
      </div>
    );
  }
  if (!operator || incident.end !== undefined) return null;

  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-foreground">
        <Button
          variant="outline"
          size="sm"
          disabled={mutation.isPending}
          aria-busy={mutation.isPending}
          aria-label={`${mutation.isPending ? 'Acknowledging' : 'Acknowledge'} incident on ${monitorName}`}
          aria-describedby={hintId}
          onClick={() => mutation.mutate()}
        >
          <IconCheck data-icon="inline-start" aria-hidden="true" />
          {mutation.isPending ? 'Acknowledging...' : 'Acknowledge'}
        </Button>
        <p id={hintId} className="text-xs text-foreground/70">
          Stops reminders. Visitors see the time, not your name.
        </p>
      </div>
      {mutation.isError && (
        <p role="alert" className="mt-1.5 text-xs text-status-down-text wrap-break-word">
          {mutationErrorMessage(mutation.error)}
        </p>
      )}
    </div>
  );
}
