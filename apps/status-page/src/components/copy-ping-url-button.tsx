import { useEffect, useReducer, useRef } from 'react';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

const COPIED_MS = 2000;
const ICON_FADE = 'transition-props-reveal duration-300 ease-standard';
const ICON_SHOWN = 'scale-100 opacity-100 blur-none';
const ICON_HIDDEN = 'scale-[0.25] opacity-0 blur-xs';

type CopyStatus =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'copied' }
  | { status: 'unavailable' }
  | { status: 'manual'; url: string };

type CopyEvent =
  | { type: 'copy' | 'copied' | 'unavailable' | 'expire' | 'close' }
  | { type: 'manual'; url: string };

function step(state: CopyStatus, event: CopyEvent): CopyStatus {
  if (event.type === 'copy') return { status: 'loading' };
  switch (state.status) {
    case 'idle':
    case 'unavailable':
      return state;
    case 'loading':
      if (event.type === 'copied') return { status: 'copied' };
      if (event.type === 'manual') return { status: 'manual', url: event.url };
      if (event.type === 'unavailable') return { status: 'unavailable' };
      return state;
    case 'copied':
      return event.type === 'expire' ? { status: 'idle' } : state;
    case 'manual':
      return event.type === 'close' ? { status: 'idle' } : state;
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

interface CopyPingUrlButtonProps {
  monitorId: string;
  monitorName: string;
  loadPingUrl: (id: string) => Promise<string | null>;
}

export function CopyPingUrlButton({ monitorId, monitorName, loadPingUrl }: CopyPingUrlButtonProps) {
  const [state, dispatch] = useReducer(step, { status: 'idle' });
  const copied = state.status === 'copied';
  const unavailable = state.status === 'unavailable';
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  async function copy() {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    dispatch({ type: 'copy' });
    try {
      const url = await loadPingUrl(monitorId);
      if (!url) {
        dispatch({ type: 'unavailable' });
      } else {
        try {
          await navigator.clipboard.writeText(url);
          dispatch({ type: 'copied' });
          copiedTimer.current = setTimeout(() => dispatch({ type: 'expire' }), COPIED_MS);
        } catch {
          dispatch({ type: 'manual', url });
        }
      }
    } catch {
      dispatch({ type: 'unavailable' });
    }
  }

  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={state.status === 'loading'}
      aria-label={`Copy ping URL for ${monitorName}`}
      onClick={() => void copy()}
    >
      <span className="relative inline-flex">
        <IconCheck
          aria-hidden="true"
          className={cn(
            'absolute inset-0 size-4 text-status-operational-text',
            ICON_FADE,
            copied ? ICON_SHOWN : ICON_HIDDEN,
          )}
        />
        <IconCopy
          aria-hidden="true"
          className={cn('size-4', ICON_FADE, copied ? ICON_HIDDEN : ICON_SHOWN)}
        />
      </span>
    </Button>
  );

  return (
    <>
      <Tooltip>
        <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
        <TooltipContent>
          {unavailable ? 'Set HEARTBEAT_SECRET to generate ping URLs' : 'Copy ping URL'}
        </TooltipContent>
      </Tooltip>

      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied' : unavailable ? 'Set HEARTBEAT_SECRET to generate ping URLs' : null}
      </span>

      <Dialog
        open={state.status === 'manual'}
        onOpenChange={(open) => !open && dispatch({ type: 'close' })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy failed, select the URL manually</DialogTitle>
          </DialogHeader>
          <Input
            readOnly
            value={state.status === 'manual' ? state.url : ''}
            variant="mono"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="flex justify-end">
            <DialogClose render={<Button variant="outline">Close</Button>} />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
