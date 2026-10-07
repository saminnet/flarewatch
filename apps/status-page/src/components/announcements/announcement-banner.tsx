import { useState } from 'react';
import { IconBroadcast, IconPencil, IconTrash } from '@tabler/icons-react';
import { formatUtcShort, isAnnouncementActive, type Announcement } from '@flarewatch/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { AnnouncementFormDialog } from './announcement-form-dialog';
import { DeleteAnnouncementDialog } from './delete-announcement-dialog';

interface AnnouncementBannerProps {
  announcements: Announcement[];
  nowMs: number;
  operator?: boolean;
  showEnded?: boolean;
}

type DialogTarget = { open: boolean; announcement?: Announcement; key: number };

const CLOSED: DialogTarget = { open: false, key: 0 };

export function AnnouncementBanner({
  announcements,
  nowMs,
  operator = false,
  showEnded = false,
}: AnnouncementBannerProps) {
  const active = showEnded
    ? announcements
    : announcements.filter((announcement) => isAnnouncementActive(announcement, nowMs));
  const [editing, setEditing] = useState(CLOSED);
  const [deleting, setDeleting] = useState(CLOSED);
  const openEdit = (announcement: Announcement) =>
    setEditing((prev) => ({ open: true, announcement, key: prev.key + 1 }));
  const openDelete = (announcement: Announcement) =>
    setDeleting((prev) => ({ open: true, announcement, key: prev.key + 1 }));
  const closeDialog = (prev: DialogTarget) => ({ ...prev, open: false });

  if (active.length === 0 && !editing.open && !deleting.open) return null;

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
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Delete announcement ${announcement.title}`}
                  onClick={() => openDelete(announcement)}
                  className="hover:text-destructive"
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
        open={editing.open}
        announcement={editing.announcement}
        onClose={() => setEditing(closeDialog)}
      />
      <DeleteAnnouncementDialog
        key={deleting.key}
        open={deleting.open}
        announcement={deleting.announcement}
        onClose={() => setDeleting(closeDialog)}
      />
    </div>
  );
}
