import type { PublicMonitor } from '@/lib/public-view';
import { useReducer } from 'react';
import { CLOSED_DIALOG, dialogStep } from '@/lib/dialog-state';
import { IconBroadcast, IconPencil, IconTrash } from '@tabler/icons-react';
import { formatUtcShort, isAnnouncementActive, type Announcement } from '@flarewatch/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AnnouncementFormDialog } from './announcement-form-dialog';
import { DeleteAnnouncementDialog } from './delete-announcement-dialog';

interface AnnouncementBannerProps {
  announcements: Announcement[];
  monitors?: PublicMonitor[];
  nowMs: number;
  operator?: boolean;
  showEnded?: boolean;
}

export function AnnouncementBanner({
  announcements,
  nowMs,
  operator = false,
  showEnded = false,
  monitors,
}: AnnouncementBannerProps) {
  const active = showEnded
    ? announcements
    : announcements.filter((announcement) => isAnnouncementActive(announcement, nowMs));
  const [editing, edit] = useReducer(dialogStep<Announcement>, CLOSED_DIALOG);
  const [deleting, remove] = useReducer(dialogStep<Announcement>, CLOSED_DIALOG);
  const openEdit = (announcement: Announcement) => edit({ type: 'open', target: announcement });
  const openDelete = (announcement: Announcement) => remove({ type: 'open', target: announcement });

  if (active.length === 0 && editing.key === 0 && deleting.key === 0) return null;

  return (
    <div className="space-y-2" aria-label="Announcements">
      {active.map((announcement) => (
        <div key={announcement.id} className="rounded-lg border border-border bg-card px-3 py-2.5">
          <div className="flex items-start gap-2">
            <IconBroadcast
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-muted-foreground"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="wrap-break-word text-sm font-medium text-foreground">
                  {announcement.title}
                </h3>
                {announcement.kind === 'incident' && (
                  <Badge variant="outline">{announcement.status ?? 'investigating'}</Badge>
                )}
                {showEnded && (
                  <Badge
                    variant={isAnnouncementActive(announcement, nowMs) ? 'secondary' : 'outline'}
                  >
                    {isAnnouncementActive(announcement, nowMs) ? 'Showing' : 'Ended'}
                  </Badge>
                )}
                {announcement.end !== undefined && (
                  <span className="text-xs text-muted-foreground">
                    {`until ${formatUtcShort(new Date(announcement.end).getTime() / 1000)}`}
                  </span>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap wrap-break-word text-sm text-muted-foreground">
                {announcement.body}
              </p>
              {(showEnded ? announcement.updates : announcement.updates?.slice(-1))?.map(
                (update) => (
                  <div key={update.at} className="mbs-2 text-sm">
                    <p>
                      {update.status} · {formatUtcShort(Date.parse(update.at) / 1000)}
                    </p>
                    <p className="whitespace-pre-wrap wrap-break-word">{update.body}</p>
                  </div>
                ),
              )}
            </div>
            {operator && (
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Edit announcement ${announcement.title}`}
                  onClick={() => openEdit(announcement)}
                >
                  <IconPencil className="size-4" />
                </Button>
                <Button
                  variant="ghost-destructive"
                  size="icon-sm"
                  aria-label={`Delete announcement ${announcement.title}`}
                  onClick={() => openDelete(announcement)}
                >
                  <IconTrash className="size-4" />
                </Button>
              </div>
            )}
          </div>
        </div>
      ))}

      <AnnouncementFormDialog
        key={editing.key}
        open={editing.status === 'open'}
        announcement={editing.target}
        monitors={monitors}
        onClose={() => edit({ type: 'close' })}
      />
      <DeleteAnnouncementDialog
        key={deleting.key}
        open={deleting.status === 'open'}
        announcement={deleting.target}
        onClose={() => remove({ type: 'close' })}
      />
    </div>
  );
}
