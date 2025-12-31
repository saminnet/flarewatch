import { useState, useMemo } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconTool, IconArrowLeft } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { MaintenanceRow } from '@/components/admin/maintenance-row';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { publicMonitorsQuery, maintenancesQuery } from '@/lib/query/monitors.queries';
import {
  useCreateMaintenance,
  useUpdateMaintenance,
  useDeleteMaintenance,
  type MaintenanceUpdatePatch,
} from '@/lib/query/maintenance.mutations';
import type { Maintenance, MaintenanceConfig } from '@flarewatch/shared';

type FormData = {
  title: string;
  body: string;
  start: Date | undefined;
  end: Date | undefined;
  monitors: string[];
  color: string;
};

const DEFAULT_FORM: FormData = {
  title: '',
  body: '',
  start: undefined,
  end: undefined,
  monitors: [],
  color: 'yellow',
};

export const Route = createFileRoute('/admin')({
  loader: async ({ context }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(publicMonitorsQuery()),
      context.queryClient.ensureQueryData(maintenancesQuery()),
    ]);
  },
  component: MaintenancesAdmin,
});

function MaintenancesAdmin() {
  const { t } = useTranslation();
  const { data: monitors } = useSuspenseQuery(publicMonitorsQuery());
  const { data: maintenances } = useSuspenseQuery(maintenancesQuery());

  const [editingMaintenance, setEditingMaintenance] = useState<Maintenance | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [formData, setFormData] = useState<FormData>(DEFAULT_FORM);

  const createMutation = useCreateMaintenance({
    onSuccess: () => {
      setIsCreating(false);
      resetForm();
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const updateMutation = useUpdateMaintenance({
    onSuccess: () => {
      setEditingMaintenance(null);
      resetForm();
    },
    onError: (error) => setErrorMessage(error.message),
  });

  const deleteMutation = useDeleteMaintenance({
    onSuccess: () => setDeleteConfirm(null),
    onError: (error) => setErrorMessage(error.message),
  });

  const resetForm = () => setFormData(DEFAULT_FORM);

  const openEditDialog = (maintenance: Maintenance) => {
    setErrorMessage(null);
    setEditingMaintenance(maintenance);
    setFormData({
      title: maintenance.title ?? '',
      body: maintenance.body,
      start: new Date(maintenance.start),
      end: maintenance.end ? new Date(maintenance.end) : undefined,
      monitors: maintenance.monitors ?? [],
      color: maintenance.color ?? 'yellow',
    });
  };

  const openCreateDialog = () => {
    setErrorMessage(null);
    setIsCreating(true);
    resetForm();
  };

  const handleSubmit = () => {
    setErrorMessage(null);
    const body = formData.body.trim();
    if (!body || !formData.start) return;
    if (formData.end && formData.end.getTime() < formData.start.getTime()) {
      setErrorMessage(t('validation.endAfterStart'));
      return;
    }

    if (editingMaintenance) {
      const patch: MaintenanceUpdatePatch = {
        title: formData.title.trim() || null,
        body,
        start: formData.start.toISOString(),
        end: formData.end ? formData.end.toISOString() : null,
        monitors: formData.monitors.length ? formData.monitors : null,
        color: formData.color.trim() || null,
      };
      updateMutation.mutate({ id: editingMaintenance.id, updates: patch });
    } else {
      const data: MaintenanceConfig = {
        title: formData.title.trim() || undefined,
        body,
        start: formData.start.toISOString(),
        end: formData.end ? formData.end.toISOString() : undefined,
        monitors: formData.monitors.length ? formData.monitors : undefined,
        color: formData.color.trim() || undefined,
      };
      createMutation.mutate(data);
    }
  };

  const toggleMonitor = (monitorId: string) => {
    setFormData((prev) => {
      const current = prev.monitors ?? [];
      if (current.includes(monitorId)) {
        return { ...prev, monitors: current.filter((id) => id !== monitorId) };
      } else {
        return { ...prev, monitors: [...current, monitorId] };
      }
    });
  };

  const sortedMaintenances = useMemo(
    () =>
      [...maintenances].sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()),
    [maintenances],
  );

  const isEndBeforeStart = Boolean(
    formData.start && formData.end && formData.end.getTime() < formData.start.getTime(),
  );

  const severityOptions = useMemo(
    () => [
      { value: 'green', label: t('severity.minor'), color: 'bg-emerald-500' },
      { value: 'yellow', label: t('event.maintenance'), color: 'bg-amber-500' },
      { value: 'blue', label: t('severity.info'), color: 'bg-blue-500' },
      { value: 'red', label: t('severity.critical'), color: 'bg-red-500' },
    ],
    [t],
  );

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/">
            <Button variant="ghost" size="sm" aria-label={t('action.goBack')}>
              <IconArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
              {t('nav.admin')}
            </h1>
            <p className="mt-1 text-sm text-neutral-500">{t('admin.subtitle')}</p>
          </div>
        </div>
        <Button onClick={openCreateDialog} aria-label={t('admin.addMaintenance')}>
          <IconPlus className="mr-2 h-4 w-4" />
          {t('admin.addMaintenance')}
        </Button>
      </div>

      {errorMessage && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {sortedMaintenances.length === 0 ? (
        <Card className="p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100 dark:bg-neutral-800">
            <IconTool className="h-6 w-6 text-neutral-500" />
          </div>
          <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
            {t('admin.noMaintenances')}
          </h3>
          <p className="mt-1 text-sm text-neutral-500">{t('admin.createFirst')}</p>
        </Card>
      ) : (
        <div className="space-y-4">
          {sortedMaintenances.map((maintenance) => (
            <MaintenanceRow
              key={maintenance.id}
              maintenance={maintenance}
              monitors={monitors}
              onEdit={() => openEditDialog(maintenance)}
              onDelete={() => setDeleteConfirm(maintenance.id)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={isCreating || !!editingMaintenance}
        onOpenChange={(open) => {
          if (!open) {
            setIsCreating(false);
            setEditingMaintenance(null);
            resetForm();
            setErrorMessage(null);
          }
        }}
      >
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
                onChange={(e) => setFormData((prev) => ({ ...prev, title: e.target.value }))}
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
                onChange={(e) => setFormData((prev) => ({ ...prev, body: e.target.value }))}
                placeholder={t('field.descriptionRequired')}
                rows={3}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs text-neutral-500">{t('field.start')} *</Label>
                <DateTimePicker
                  value={formData.start}
                  onChange={(date) => setFormData((prev) => ({ ...prev, start: date }))}
                  placeholder={t('field.selectStart')}
                />
              </div>
              <div>
                <Label className="text-xs text-neutral-500">{t('field.end')}</Label>
                <DateTimePicker
                  value={formData.end}
                  onChange={(date) => setFormData((prev) => ({ ...prev, end: date }))}
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
              <div className="mt-1.5 flex gap-2">
                {severityOptions.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setFormData((prev) => ({ ...prev, color: option.value }))}
                    aria-pressed={formData.color === option.value}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                      formData.color === option.value
                        ? 'border-neutral-900 bg-neutral-100 dark:border-neutral-100 dark:bg-neutral-800'
                        : 'border-neutral-200 hover:border-neutral-300 dark:border-neutral-700 dark:hover:border-neutral-600'
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${option.color}`} />
                    {option.label}
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
                    variant={formData.monitors?.includes(monitor.id) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleMonitor(monitor.id)}
                    render={<button type="button" />}
                    aria-pressed={formData.monitors?.includes(monitor.id)}
                  >
                    {monitor.name}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline">{t('action.cancel')}</Button>} />
            <Button
              onClick={handleSubmit}
              disabled={
                !formData.body.trim() ||
                !formData.start ||
                isEndBeforeStart ||
                createMutation.isPending ||
                updateMutation.isPending
              }
            >
              {createMutation.isPending || updateMutation.isPending
                ? t('action.saving')
                : t('action.save')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('admin.deleteMaintenance')}</DialogTitle>
          </DialogHeader>
          <p className="py-4 text-neutral-600 dark:text-neutral-400">{t('admin.confirmDelete')}</p>
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="outline">{t('action.cancel')}</Button>} />
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? t('action.deleting') : t('action.delete')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
