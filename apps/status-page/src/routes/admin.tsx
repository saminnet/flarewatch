import { useState, useMemo, useCallback } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { IconPlus, IconTool, IconArrowLeft } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { MaintenanceRow } from '@/components/admin/maintenance-row';
import { AdminLoginForm } from '@/components/admin/admin-login-form';
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
import { useAdminLogout, isSessionExpiredError } from '@/lib/query/auth.mutations';
import { checkAdminAuthServerFn, type AdminAuthState } from '@/lib/auth-server';
import { useMaintenanceForm } from '@/lib/hooks/use-maintenance-form';
import type { Maintenance, MaintenanceConfig } from '@flarewatch/shared';
import { SEVERITY_OPTIONS } from '@/lib/maintenance';
import { PAGE_CONTAINER_CLASSES } from '@/lib/constants';

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const authState = await checkAdminAuthServerFn();
    return { authState };
  },
  loader: async ({ context }) => {
    // Access authState from beforeLoad context
    const { authState } = context as {
      authState: AdminAuthState;
      queryClient: typeof context.queryClient;
    };

    // Only prefetch data if authenticated
    if (authState === 'authenticated') {
      await Promise.all([
        context.queryClient.ensureQueryData(publicMonitorsQuery()),
        context.queryClient.ensureQueryData(maintenancesQuery()),
      ]);
    }

    return { authState };
  },
  component: AdminPage,
});

function AdminPage() {
  const { authState: initialAuthState } = Route.useLoaderData();
  const { t } = useTranslation();
  const [auth, setAuth] = useState<AdminAuthState>(initialAuthState);

  const handleSessionExpired = useCallback(() => {
    setAuth('unauthenticated');
  }, []);

  const logoutMutation = useAdminLogout({
    onSuccess: handleSessionExpired,
    onError: () => {
      // Logout failed, but still redirect to login for safety
      handleSessionExpired();
    },
  });

  const handleLogout = useCallback(() => {
    logoutMutation.mutate();
  }, [logoutMutation]);

  if (auth === 'not_configured') {
    return (
      <div className={PAGE_CONTAINER_CLASSES}>
        <EmptyState
          icon={IconTool}
          title={t('admin.notConfigured')}
          description={t('admin.notConfiguredDesc')}
        />
        <div className="mt-6">
          <Link to="/">
            <Button variant="outline">{t('action.goBack')}</Button>
          </Link>
        </div>
      </div>
    );
  }

  if (auth === 'unauthenticated') {
    return <AdminLoginForm onLoginSuccess={() => setAuth('authenticated')} />;
  }

  return (
    <MaintenancesAdminAuthed onLogout={handleLogout} onSessionExpired={handleSessionExpired} />
  );
}

function MaintenancesAdminAuthed({
  onLogout,
  onSessionExpired,
}: {
  onLogout: () => void;
  onSessionExpired: () => void;
}) {
  const { t } = useTranslation();
  const { data: monitors } = useSuspenseQuery(publicMonitorsQuery());
  const { data: maintenances } = useSuspenseQuery(maintenancesQuery());

  const [editingMaintenance, setEditingMaintenance] = useState<Maintenance | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const {
    formData,
    errorMessage,
    setErrorMessage,
    resetForm,
    updateField,
    toggleMonitor,
    populateFromMaintenance,
    isEndBeforeStart,
    isValid,
  } = useMaintenanceForm();

  // Handle session expiry in mutation errors
  const handleMutationError = useCallback(
    (error: Error) => {
      if (isSessionExpiredError(error)) {
        onSessionExpired();
      } else {
        setErrorMessage(error.message);
      }
    },
    [onSessionExpired, setErrorMessage],
  );

  const createMutation = useCreateMaintenance({
    onSuccess: () => {
      setIsCreating(false);
      resetForm();
    },
    onError: handleMutationError,
  });

  const updateMutation = useUpdateMaintenance({
    onSuccess: () => {
      setEditingMaintenance(null);
      resetForm();
    },
    onError: handleMutationError,
  });

  const deleteMutation = useDeleteMaintenance({
    onSuccess: () => setDeleteConfirm(null),
    onError: handleMutationError,
  });

  const openEditDialog = useCallback(
    (maintenance: Maintenance) => {
      setEditingMaintenance(maintenance);
      populateFromMaintenance(maintenance);
    },
    [populateFromMaintenance],
  );

  const openCreateDialog = useCallback(() => {
    setErrorMessage(null);
    setIsCreating(true);
    resetForm();
  }, [resetForm, setErrorMessage]);

  const closeDialog = useCallback(() => {
    setIsCreating(false);
    setEditingMaintenance(null);
    resetForm();
  }, [resetForm]);

  const handleSubmit = useCallback(() => {
    setErrorMessage(null);
    const body = formData.body.trim();
    if (!body || !formData.start) return;
    if (isEndBeforeStart) {
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
  }, [
    formData,
    isEndBeforeStart,
    editingMaintenance,
    createMutation,
    updateMutation,
    setErrorMessage,
    t,
  ]);

  const handleDeleteConfirm = useCallback((id: string) => {
    setDeleteConfirm(id);
  }, []);

  const handleDelete = useCallback(() => {
    if (deleteConfirm) {
      deleteMutation.mutate(deleteConfirm);
    }
  }, [deleteConfirm, deleteMutation]);

  const sortedMaintenances = useMemo(
    () =>
      [...maintenances].sort((a, b) => new Date(b.start).getTime() - new Date(a.start).getTime()),
    [maintenances],
  );

  return (
    <div className={PAGE_CONTAINER_CLASSES}>
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
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onLogout}>
            {t('action.signOut')}
          </Button>
          <Button onClick={openCreateDialog} aria-label={t('admin.addMaintenance')}>
            <IconPlus className="mr-2 h-4 w-4" />
            {t('admin.addMaintenance')}
          </Button>
        </div>
      </div>

      {errorMessage && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {sortedMaintenances.length === 0 ? (
        <EmptyState
          icon={IconTool}
          title={t('admin.noMaintenances')}
          description={t('admin.createFirst')}
        />
      ) : (
        <div className="space-y-4">
          {sortedMaintenances.map((maintenance) => (
            <MaintenanceRow
              key={maintenance.id}
              maintenance={maintenance}
              monitors={monitors}
              onEdit={() => openEditDialog(maintenance)}
              onDelete={() => handleDeleteConfirm(maintenance.id)}
            />
          ))}
        </div>
      )}

      <Dialog
        open={isCreating || !!editingMaintenance}
        onOpenChange={(open) => {
          if (!open) closeDialog();
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
            <Button
              onClick={handleSubmit}
              disabled={!isValid || createMutation.isPending || updateMutation.isPending}
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
              onClick={handleDelete}
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
