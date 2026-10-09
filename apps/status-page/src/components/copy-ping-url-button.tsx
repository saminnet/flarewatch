import { useEffect, useRef, useState } from 'react';
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

interface CopyPingUrlButtonProps {
  monitorId: string;
  monitorName: string;
  loadPingUrl: (id: string) => Promise<string | null>;
}

export function CopyPingUrlButton({ monitorId, monitorName, loadPingUrl }: CopyPingUrlButtonProps) {
  const [copied, setCopied] = useState(false);
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const [isPending, setIsPending] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function copy() {
    setIsPending(true);
    setUnavailable(false);
    try {
      const url = await loadPingUrl(monitorId);
      if (!url) {
        setUnavailable(true);
      } else {
        try {
          await navigator.clipboard.writeText(url);
          setCopied(true);
          copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
        } catch {
          setManualUrl(url);
        }
      }
    } catch {
      setUnavailable(true);
    }
    setIsPending(false);
  }

  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={isPending}
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

      <Dialog open={manualUrl !== null} onOpenChange={(open) => !open && setManualUrl(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy failed, select the URL manually</DialogTitle>
          </DialogHeader>
          <Input
            readOnly
            value={manualUrl ?? ''}
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
