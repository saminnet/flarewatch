import { useState } from 'react';
import { IconBroadcast } from '@tabler/icons-react';
import type { Announcement } from '@flarewatch/shared';
import { Button } from '@/components/ui/button';
import { AnnouncementFormDialog } from './announcement-form-dialog';
import { AnnouncementBanner } from './announcement-banner';

export function AddAnnouncementButton() {
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
        onClose={() => setDialog((prev) => ({ ...prev, open: false }))}
      />
    </>
  );
}

export function ManageAnnouncements({
  announcements,
  nowMs,
  operator,
}: {
  announcements: Announcement[];
  nowMs: number;
  operator: boolean;
}) {
  if (!operator || announcements.length === 0) return null;
  return (
    <section aria-label="Manage announcements" className="mb-6">
      <h2 className="mb-2 text-base font-semibold">Announcements</h2>
      <AnnouncementBanner announcements={announcements} nowMs={nowMs} operator showEnded />
    </section>
  );
}
