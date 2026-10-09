import { useState } from 'react';
import type { Announcement } from '@flarewatch/shared';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDeleteAnnouncement } from '@/lib/query/announcement.mutations';
import { mutationErrorMessage } from '@/lib/query/auth.mutations';

interface DeleteAnnouncementDialogProps {
  open: boolean;
  announcement?: Announcement;
  onClose: () => void;
}

export function DeleteAnnouncementDialog({
  open,
  announcement,
  onClose,
}: DeleteAnnouncementDialogProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const deleteMutation = useDeleteAnnouncement({
    onSuccess: onClose,
    onError: (error) => setErrorMessage(mutationErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete announcement</DialogTitle>
        </DialogHeader>
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <p className="py-4 text-muted-foreground">
          {`Delete "${announcement?.title ?? announcement?.body.slice(0, 80) ?? 'this announcement'}"? This cannot be undone.`}
        </p>
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            variant="destructive"
            onClick={() => announcement && deleteMutation.mutate(announcement.id)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
