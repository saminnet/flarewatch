import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
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
const ICON_FADE = 'transition-[opacity,filter,scale] duration-300 ease-[cubic-bezier(0.2,0,0,1)]';
const ICON_SHOWN = 'scale-100 opacity-100 blur-0';
const ICON_HIDDEN = 'scale-[0.25] opacity-0 blur-[4px]';

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

  const copyMutation = useMutation({
    mutationFn: () => loadPingUrl(monitorId),
    onSuccess: async (url) => {
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
      } catch {
        setManualUrl(url);
      }
    },
  });
  const unavailable = copyMutation.isError || copyMutation.data === null;

  const button = (
    <Button
      variant="ghost"
      size="icon-sm"
      disabled={copyMutation.isPending}
      aria-label={`Copy ping URL for ${monitorName}`}
      onClick={() => copyMutation.mutate()}
    >
      <span className="relative inline-flex">
        <IconCheck
          aria-hidden="true"
          className={cn(
            'absolute inset-0 size-4 text-status-operational',
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
            className="font-mono text-xs"
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
