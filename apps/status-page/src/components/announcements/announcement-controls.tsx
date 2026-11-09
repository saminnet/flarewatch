import { useReducer } from 'react';
import { CLOSED_DIALOG, dialogStep } from '@/lib/dialog-state';
import { IconBroadcast } from '@tabler/icons-react';
import type { Announcement } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/public-view';
import { Button } from '@/components/ui/button';
import { AnnouncementFormDialog } from './announcement-form-dialog';
import { AnnouncementBanner } from './announcement-banner';

export function AddAnnouncementButton({ monitors }: { monitors?: PublicMonitor[] }) {
  const [dialog, dispatch] = useReducer(dialogStep<undefined>, CLOSED_DIALOG);
  return (
    <>
      <Button variant="outline" onClick={() => dispatch({ type: 'open' })}>
        <IconBroadcast className="size-4" />
        Add announcement
      </Button>
      <AnnouncementFormDialog
        key={dialog.key}
        open={dialog.status === 'open'}
        monitors={monitors}
        onClose={() => dispatch({ type: 'close' })}
      />
    </>
  );
}

export function ManageAnnouncements({
  announcements,
  nowMs,
  operator,
  monitors,
}: {
  announcements: Announcement[];
  monitors?: PublicMonitor[];
  nowMs: number;
  operator: boolean;
}) {
  if (announcements.length === 0) return null;
  return (
    <section aria-label={operator ? 'Manage announcements' : 'Announcements'} className="mb-6">
      <h2 className="mb-2 text-base font-semibold">Announcements</h2>
      <AnnouncementBanner
        announcements={announcements}
        nowMs={nowMs}
        monitors={monitors}
        operator={operator}
        showEnded
      />
    </section>
  );
}
