import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import type { Maintenance } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/public-view';
import { SEVERITY_OPTIONS, getMaintenanceColors } from '@/lib/maintenance';
import {
  toMaintenanceConfig,
  toMaintenancePatch,
  useMaintenanceForm,
} from '@/lib/hooks/use-maintenance-form';
import { useCreateMaintenance, useUpdateMaintenance } from '@/lib/query/maintenance.mutations';
import { mutationErrorMessage } from '@/lib/query/auth.mutations';

interface MaintenanceFormDialogProps {
  open: boolean;
  /** The window to edit; a new one when left out. */
  maintenance?: Maintenance;
  monitors: PublicMonitor[];
  onClose: () => void;
}

export function MaintenanceFormDialog({
  open,
  maintenance,
  monitors,
  onClose,
}: MaintenanceFormDialogProps) {
  const { formData, updateField, toggleMonitor, isEndBeforeStart, isValid } =
    useMaintenanceForm(maintenance);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const callbacks = {
    onSuccess: onClose,
    onError: (error: Error) => setErrorMessage(mutationErrorMessage(error)),
  };
  const createMutation = useCreateMaintenance(callbacks);
  const updateMutation = useUpdateMaintenance(callbacks);
  const isPending = createMutation.isPending || updateMutation.isPending;

  function handleSubmit() {
    const { start } = formData;
    if (!isValid || !start) return;
    setErrorMessage(null);
    if (maintenance) {
      updateMutation.mutate({
        id: maintenance.id,
        updates: toMaintenancePatch({ ...formData, start }),
      });
    } else {
      createMutation.mutate(toMaintenanceConfig({ ...formData, start }));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {maintenance ? 'Edit maintenance window' : 'Add maintenance window'}
          </DialogTitle>
        </DialogHeader>

        {errorMessage && (
          <Alert variant="destructive">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4 pb-4">
          <div>
            <Label htmlFor="title" className="sr-only">
              Title
            </Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder="Title (optional)"
            />
          </div>

          <div>
            <Label htmlFor="body" className="sr-only">
              Description
            </Label>
            <Textarea
              id="body"
              value={formData.body}
              onChange={(e) => updateField('body', e.target.value)}
              placeholder="Description *"
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground">Start *</Label>
              <DateTimePicker
                value={formData.start}
                onChange={(date) => updateField('start', date)}
                placeholder="Select start date"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">End</Label>
              <DateTimePicker
                value={formData.end}
                onChange={(date) => updateField('end', date)}
                placeholder="Select end date"
                clearLabel="Clear"
              />
              {isEndBeforeStart && (
                <p className="mt-1 text-xs text-destructive">End must be after start</p>
              )}
            </div>
          </div>

          <fieldset>
            <legend className="text-xs text-muted-foreground">Severity</legend>
            <div className="mt-1.5 flex gap-2">
              {SEVERITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateField('color', option.value)}
                  aria-label={option.label}
                  aria-pressed={formData.color === option.value}
                  className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    formData.color === option.value
                      ? 'border-foreground bg-muted'
                      : 'border-border hover:border-input'
                  }`}
                >
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${getMaintenanceColors(option.value).dot}`}
                    aria-hidden="true"
                  />
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div>
            <Label className="text-xs text-muted-foreground">Affected Monitors</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {monitors.map((monitor) => (
                <Badge
                  key={monitor.id}
                  variant={formData.monitors.includes(monitor.id) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleMonitor(monitor.id)}
                  render={<button type="button" aria-label={monitor.name} />}
                  aria-pressed={formData.monitors.includes(monitor.id)}
                >
                  {monitor.name}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button onClick={handleSubmit} disabled={!isValid || isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
