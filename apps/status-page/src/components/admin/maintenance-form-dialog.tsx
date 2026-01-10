import { useTranslation } from 'react-i18next';
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
import type { PublicMonitor } from '@/lib/monitors';
import { SEVERITY_OPTIONS } from '@/lib/maintenance';
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
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editingMaintenance ? t('admin.editMaintenance') : t('admin.addMaintenance')}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pb-4">
          <div>
            <Label htmlFor="title" className="sr-only">
              {t('field.title')}
            </Label>
            <Input
              id="title"
              value={formData.title}
              onChange={(e) => updateField('title', e.target.value)}
              placeholder={t('field.titleOptional')}
            />
          </div>

          <div>
            <Label htmlFor="body" className="sr-only">
              {t('field.description')}
            </Label>
            <Textarea
              id="body"
              value={formData.body}
              onChange={(e) => updateField('body', e.target.value)}
              placeholder={t('field.descriptionRequired')}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs text-neutral-500">{t('field.start')} *</Label>
              <DateTimePicker
                value={formData.start}
                onChange={(date) => updateField('start', date)}
                placeholder={t('field.selectStart')}
              />
            </div>
            <div>
              <Label className="text-xs text-neutral-500">{t('field.end')}</Label>
              <DateTimePicker
                value={formData.end}
                onChange={(date) => updateField('end', date)}
                placeholder={t('field.selectEnd')}
                clearLabel={t('action.clear')}
              />
              {isEndBeforeStart && (
                <p className="mt-1 text-xs text-red-600 dark:text-red-400">
                  {t('validation.endAfterStart')}
                </p>
              )}
            </div>
          </div>

          <div>
            <Label className="text-xs text-neutral-500">{t('field.severity')}</Label>
            <div className="mt-1.5 flex gap-2" role="group" aria-label={t('field.severity')}>
              {SEVERITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => updateField('color', option.value)}
                  aria-label={t(option.labelKey)}
                  aria-pressed={formData.color === option.value}
                  className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                    formData.color === option.value
                      ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
                      : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600'
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${option.dot}`} aria-hidden="true" />
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs text-neutral-500">{t('field.affectedMonitors')}</Label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              {monitors.map((monitor) => (
                <Badge
                  key={monitor.id}
                  variant={formData.monitors.includes(monitor.id) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleMonitor(monitor.id)}
                  render={<button type="button" />}
                  aria-pressed={formData.monitors.includes(monitor.id)}
                >
                  {monitor.name}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <DialogClose render={<Button variant="outline">{t('action.cancel')}</Button>} />
          <Button onClick={onSubmit} disabled={!isValid || isPending}>
            {isPending ? t('action.saving') : t('action.save')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
