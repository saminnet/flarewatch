import { useState } from 'react';
import { IconBroadcast } from '@tabler/icons-react';
import type { Announcement } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/public-view';
import { Button } from '@/components/ui/button';
import { AnnouncementFormDialog } from './announcement-form-dialog';
import { AnnouncementBanner } from './announcement-banner';

export function AddAnnouncementButton({ monitors }: { monitors?: PublicMonitor[] }) {
  const [dialog, setDialog] = useState({ open: false, key: 0 });
  return (
    <>
      <Button
        variant="outline"
        onClick={() => setDialog((prev) => ({ open: true, key: prev.key + 1 }))}
      >
        <IconBroadcast className="size-4" />
        Add announcement
      </Button>
      <AnnouncementFormDialog
        key={dialog.key}
        open={dialog.open}
        monitors={monitors}
        onClose={() => setDialog((prev) => ({ ...prev, open: false }))}
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
