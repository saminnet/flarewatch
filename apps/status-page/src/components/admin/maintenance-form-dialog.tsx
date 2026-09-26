import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import type { MaintenanceFormData } from '@/lib/hooks/use-maintenance-form';

interface MaintenanceFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingMaintenance: Maintenance | null;
  formData: MaintenanceFormData;
  monitors: PublicMonitor[];
  updateField: <K extends keyof MaintenanceFormData>(key: K, value: MaintenanceFormData[K]) => void;
  toggleMonitor: (id: string) => void;
  isEndBeforeStart: boolean;
  isValid: boolean;
  isPending: boolean;
  onSubmit: () => void;
}

export function MaintenanceFormDialog({
  open,
  onOpenChange,
  editingMaintenance,
  formData,
  monitors,
  updateField,
  toggleMonitor,
  isEndBeforeStart,
  isValid,
  isPending,
  onSubmit,
}: MaintenanceFormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editingMaintenance ? 'Edit maintenance window' : 'Add maintenance window'}
          </DialogTitle>
        </DialogHeader>

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
          <Button onClick={onSubmit} disabled={!isValid || isPending}>
            {isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
