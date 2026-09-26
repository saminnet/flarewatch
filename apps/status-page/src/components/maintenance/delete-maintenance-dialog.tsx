import { useState } from 'react';
import type { Maintenance } from '@flarewatch/shared';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDeleteMaintenance } from '@/lib/query/maintenance.mutations';
import { mutationErrorMessage } from '@/lib/query/auth.mutations';

interface DeleteMaintenanceDialogProps {
  open: boolean;
  maintenance?: Maintenance;
  onClose: () => void;
}

export function DeleteMaintenanceDialog({
  open,
  maintenance,
  onClose,
}: DeleteMaintenanceDialogProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const deleteMutation = useDeleteMaintenance({
    onSuccess: onClose,
    onError: (error) => setErrorMessage(mutationErrorMessage(error)),
  });

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete maintenance window</DialogTitle>
        </DialogHeader>
        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}
        <p className="py-4 text-muted-foreground">
          {`Delete "${maintenance?.title ?? 'Scheduled Maintenance'}"? This cannot be undone.`}
        </p>
        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button
            variant="destructive"
            onClick={() => maintenance && deleteMutation.mutate(maintenance.id)}
            disabled={deleteMutation.isPending}
          >
            {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
