import { useState } from 'react';
import type { Announcement, AnnouncementConfig } from '@flarewatch/shared';
import { normalizeAnnouncement } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/public-view';
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
import { IncidentFields, type IncidentFieldsValue } from './incident-fields';

interface AnnouncementFormDialogProps {
  open: boolean;
  monitors?: PublicMonitor[];
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

function incidentConfig(incident: IncidentFieldsValue) {
  return incident.kind === 'incident'
    ? { kind: incident.kind, status: incident.status, monitors: incident.monitors }
    : {};
}

function incidentUpdate(incident: IncidentFieldsValue) {
  if (incident.kind !== 'incident' || incident.updateBody === undefined) return {};
  return { addUpdate: { status: incident.status, body: incident.updateBody } };
}

function hasEmptyUpdate(incident: IncidentFieldsValue): boolean {
  return (
    incident.kind === 'incident' && incident.updateBody !== undefined && !incident.updateBody.trim()
  );
}

function announcementDefaults(announcement?: Announcement) {
  return {
    title: announcement?.title ?? '',
    body: announcement?.body ?? '',
    end: announcement?.end !== undefined ? new Date(announcement.end) : undefined,
    incident: {
      kind: announcement?.kind ?? 'notice',
      status: announcement?.status ?? 'investigating',
      monitors: announcement?.monitors ?? [],
    },
    updateCount: announcement?.updates?.length ?? 0,
  };
}

export function AnnouncementFormDialog({
  open,
  announcement,
  onClose,
  monitors = [],
}: AnnouncementFormDialogProps) {
  const defaults = announcementDefaults(announcement);
  const [incident, setIncident] = useState<IncidentFieldsValue>(defaults.incident);
  const [title, setTitle] = useState(defaults.title);
  const [body, setBody] = useState(defaults.body);
  const [end, setEnd] = useState(defaults.end);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const callbacks = {
    onSuccess: onClose,
    onError: (error: Error) => setErrorMessage(mutationErrorMessage(error)),
  };
  const createMutation = useCreateAnnouncement(callbacks);
  const updateMutation = useUpdateAnnouncement(callbacks);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const fields = incidentConfig(incident);
  const config = { ...toConfig(title, body, end), ...fields };
  const result = normalizeAnnouncement(config);
  const emptyUpdate = hasEmptyUpdate(incident);
  const error = 'error' in result && body.trim() ? result.error : null;

  function handleSubmit() {
    if ('error' in result || emptyUpdate) return;
    setErrorMessage(null);
    if (announcement) {
      updateMutation.mutate({
        id: announcement.id,
        updates: {
          ...toPatch(title, body, end),
          ...fields,
          ...incidentUpdate(incident),
        },
      });
    } else {
      createMutation.mutate(config);
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
          <IncidentFields
            value={incident}
            onChange={setIncident}
            monitors={monitors}
            editing={announcement !== undefined}
            updateCount={defaults.updateCount}
          />
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
          <Button onClick={handleSubmit} disabled={'error' in result || emptyUpdate || isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
