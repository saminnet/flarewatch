import { useState, useMemo, useCallback } from 'react';
import { useSuspenseQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  IconPlus,
  IconTool,
  IconArrowLeft,
  IconCalendarEvent,
  IconAlertTriangle,
  IconClock,
  IconCircleCheck,
} from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { getMaintenanceStatus } from '@/lib/maintenance';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MaintenanceRow } from '@/components/admin/maintenance-row';
import { MaintenanceFormDialog } from '@/components/admin/maintenance-form-dialog';
import { AdminLoginForm } from '@/components/admin/admin-login-form';
import { Alert, AlertDescription } from '@/components/ui/alert';
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
import { useNow } from '@/lib/hooks/use-now';
import type { Maintenance, MaintenanceConfig } from '@flarewatch/shared';
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

    // Capture timestamp at load time for SSR hydration consistency
    const loaderNowMs = Date.now();
    return { authState, loaderNowMs };
  },
  component: AdminPage,
});

function AdminPage() {
  const { authState: initialAuthState, loaderNowMs } = Route.useLoaderData();
  const { t } = useTranslation();
  const [auth, setAuth] = useState<AdminAuthState>(initialAuthState);

  const nowMs = useNow({
    serverTime: loaderNowMs,
    enabled: auth === 'authenticated',
  });

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
    <MaintenancesAdminAuthed
      onLogout={handleLogout}
      onSessionExpired={handleSessionExpired}
      nowMs={nowMs}
    />
  );
}

function MaintenancesAdminAuthed({
  onLogout,
  onSessionExpired,
  nowMs,
}: {
  onLogout: () => void;
  onSessionExpired: () => void;
  nowMs: number;
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
      setErrorMessage(null);
      setEditingMaintenance(maintenance);
      populateFromMaintenance(maintenance);
    },
    [populateFromMaintenance, setErrorMessage],
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
    if (!body || !formData.start || isEndBeforeStart) return;

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

  const maintenanceSummary = useMemo(() => {
    let active = 0;
    let upcoming = 0;
    let past = 0;

    for (const maintenance of maintenances) {
      const status = getMaintenanceStatus(maintenance, nowMs);
      if (status === 'active') {
        active += 1;
      } else if (status === 'past') {
        past += 1;
      } else {
        upcoming += 1;
      }
    }

    return { active, upcoming, past };
  }, [maintenances, nowMs]);

  return (
    <div className={PAGE_CONTAINER_CLASSES}>
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/">
              <Button variant="ghost" size="icon-sm" aria-label={t('action.goBack')}>
                <IconArrowLeft className="size-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-orange-500/10">
                <IconCalendarEvent className="size-5 text-orange-500" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-neutral-900 dark:text-neutral-100">
                  {t('nav.admin')}
                </h1>
                <p className="text-sm text-neutral-500">{t('admin.subtitle')}</p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onLogout}>
              {t('action.signOut')}
            </Button>
            {sortedMaintenances.length !== 0 && (
              <Button
                onClick={openCreateDialog}
                aria-label={t('admin.addMaintenance')}
                className="bg-orange-500 hover:bg-orange-600 text-white"
              >
                <IconPlus className="mr-2 size-4" />
                {t('admin.addMaintenance')}
              </Button>
            )}
          </div>
        </div>

        {/* Stats summary */}
        {sortedMaintenances.length > 0 && (
          <div className="mt-6 flex gap-4">
            <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <IconAlertTriangle className="size-4 text-amber-500" />
              <span>
                {maintenanceSummary.active} {t('status.ongoing')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <IconClock className="size-4 text-blue-500" />
              <span>
                {maintenanceSummary.upcoming} {t('status.upcoming')}
              </span>
            </div>
            <div className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-400">
              <IconCircleCheck className="size-4 text-emerald-500" />
              <span>
                {maintenanceSummary.past} {t('status.completed')}
              </span>
            </div>
          </div>
        )}
      </div>

      {errorMessage && (
        <Alert variant="destructive" className="mb-6">
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {sortedMaintenances.length === 0 ? (
        <div className="py-16 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-neutral-100 dark:bg-neutral-800 mb-4">
            <IconCalendarEvent className="size-8 text-neutral-400" />
          </div>
          <h3 className="text-lg font-medium text-neutral-900 dark:text-neutral-100">
            {t('admin.noMaintenances')}
          </h3>
          <p className="mt-1 text-sm text-neutral-500 max-w-sm mx-auto">{t('admin.createFirst')}</p>
          <Button
            onClick={openCreateDialog}
            className="mt-6 bg-orange-500 hover:bg-orange-600 text-white"
          >
            <IconPlus className="mr-2 size-4" />
            {t('admin.addMaintenance')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {sortedMaintenances.map((maintenance) => (
            <MaintenanceRow
              key={maintenance.id}
              maintenance={maintenance}
              monitors={monitors}
              nowMs={nowMs}
              onEdit={() => openEditDialog(maintenance)}
              onDelete={() => handleDeleteConfirm(maintenance.id)}
            />
          ))}
        </div>
      )}

      <MaintenanceFormDialog
        open={isCreating || !!editingMaintenance}
        onOpenChange={(open) => {
          if (!open) closeDialog();
        }}
        editingMaintenance={editingMaintenance}
        formData={formData}
        monitors={monitors}
        updateField={updateField}
        toggleMonitor={toggleMonitor}
        isEndBeforeStart={isEndBeforeStart}
        isValid={isValid}
        isPending={createMutation.isPending || updateMutation.isPending}
        onSubmit={handleSubmit}
      />

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
