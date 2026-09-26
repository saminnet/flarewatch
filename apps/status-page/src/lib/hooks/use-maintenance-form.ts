import { useState } from 'react';
import type { Maintenance, MaintenanceConfig } from '@flarewatch/shared';
import type { MaintenanceUpdatePatch } from '@/lib/query/maintenance.mutations';

export type MaintenanceFormData = {
  title: string;
  body: string;
  start: Date | undefined;
  end: Date | undefined;
  monitors: string[];
  color: string;
};

type ValidForm = MaintenanceFormData & { start: Date };

function formFrom(maintenance?: Maintenance): MaintenanceFormData {
  return {
    title: maintenance?.title ?? '',
    body: maintenance?.body ?? '',
    start: maintenance ? new Date(maintenance.start) : undefined,
    end: maintenance?.end ? new Date(maintenance.end) : undefined,
    monitors: maintenance?.monitors ?? [],
    color: maintenance?.color ?? 'yellow',
  };
}

/** The create body: blank optional fields are left out. */
export function toMaintenanceConfig(form: ValidForm): MaintenanceConfig {
  return {
    title: form.title.trim() || undefined,
    body: form.body.trim(),
    start: form.start.toISOString(),
    end: form.end?.toISOString(),
    monitors: form.monitors.length ? form.monitors : undefined,
    color: form.color.trim() || undefined,
  };
}

/** The update body: blank optional fields are sent as null to clear them. */
export function toMaintenancePatch(form: ValidForm): MaintenanceUpdatePatch {
  return {
    title: form.title.trim() || null,
    body: form.body.trim(),
    start: form.start.toISOString(),
    end: form.end?.toISOString() ?? null,
    monitors: form.monitors.length ? form.monitors : null,
    color: form.color.trim() || null,
  };
}

export function useMaintenanceForm(maintenance?: Maintenance) {
  const [formData, setFormData] = useState(() => formFrom(maintenance));

  function updateField<K extends keyof MaintenanceFormData>(
    field: K,
    value: MaintenanceFormData[K],
  ) {
    setFormData((prev) => ({ ...prev, [field]: value }));
  }

  function toggleMonitor(monitorId: string) {
    setFormData((prev) => {
      const current = prev.monitors;
      if (current.includes(monitorId)) {
        return { ...prev, monitors: current.filter((id) => id !== monitorId) };
      }
      return { ...prev, monitors: [...current, monitorId] };
    });
  }

  const isEndBeforeStart = Boolean(
    formData.start && formData.end && formData.end.getTime() < formData.start.getTime(),
  );

  const isValid = formData.body.trim() !== '' && formData.start !== undefined && !isEndBeforeStart;

  return { formData, updateField, toggleMonitor, isEndBeforeStart, isValid };
}
