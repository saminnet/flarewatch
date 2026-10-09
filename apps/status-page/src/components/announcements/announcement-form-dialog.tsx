import { useState } from 'react';
import type { Announcement, AnnouncementConfig } from '@flarewatch/shared';
import { normalizeAnnouncement } from '@flarewatch/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { DateTimePicker } from '@/components/ui/datetime-picker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog';
import {
  useCreateAnnouncement,
  useUpdateAnnouncement,
  type AnnouncementUpdatePatch,
} from '@/lib/query/announcement.mutations';
import { mutationErrorMessage } from '@/lib/query/auth.mutations';

interface AnnouncementFormDialogProps {
  open: boolean;
  announcement?: Announcement;
  onClose: () => void;
}

function toConfig(title: string, body: string, end: Date | undefined): AnnouncementConfig {
  return {
    title: title.trim(),
    body: body.trim(),
    end: end?.toISOString(),
  };
}

function toPatch(title: string, body: string, end: Date | undefined): AnnouncementUpdatePatch {
  return {
    title: title.trim(),
    body: body.trim(),
    end: end?.toISOString() ?? null,
  };
}

export function AnnouncementFormDialog({
  open,
  announcement,
  onClose,
}: AnnouncementFormDialogProps) {
  const [title, setTitle] = useState(announcement?.title ?? '');
  const [body, setBody] = useState(announcement?.body ?? '');
  const [end, setEnd] = useState(() =>
    announcement?.end !== undefined ? new Date(announcement.end) : undefined,
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const callbacks = {
    onSuccess: onClose,
    onError: (error: Error) => setErrorMessage(mutationErrorMessage(error)),
  };
  const createMutation = useCreateAnnouncement(callbacks);
  const updateMutation = useUpdateAnnouncement(callbacks);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const result = normalizeAnnouncement(toConfig(title, body, end));
  const error = 'error' in result && body.trim() ? result.error : null;

  function handleSubmit() {
    if ('error' in result) return;
    setErrorMessage(null);
    if (announcement) {
      updateMutation.mutate({ id: announcement.id, updates: toPatch(title, body, end) });
    } else {
      createMutation.mutate(toConfig(title, body, end));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{announcement ? 'Edit announcement' : 'Add announcement'}</DialogTitle>
        </DialogHeader>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4 pb-4">
          <div>
            <Label htmlFor="announcement-title" className="sr-only">
              Title
            </Label>
            <Input
              id="announcement-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title *"
              maxLength={200}
            />
          </div>

          <div>
            <Label htmlFor="announcement-body" className="sr-only">
              Body
            </Label>
            <Textarea
              id="announcement-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Body *"
              rows={4}
              maxLength={2000}
            />
          </div>

          <div>
            <Label variant="muted">Shows until</Label>
            <div className="mt-1.5">
              <DateTimePicker
                value={end}
                onChange={setEnd}
                placeholder="For good, until you delete it"
                clearLabel="Clear"
                align="end"
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button onClick={handleSubmit} disabled={'error' in result || isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
