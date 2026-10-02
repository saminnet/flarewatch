import { useState } from 'react';
import {
  normalizeMaintenance,
  type Maintenance,
  type MaintenanceConfig,
  type MaintenanceRepeat,
} from '@flarewatch/shared';
import type { MaintenanceUpdatePatch } from '@/lib/query/maintenance.mutations';

export type MaintenanceFormData = {
  title: string;
  body: string;
  start: Date | undefined;
  end: Date | undefined;
  monitors: string[];
  color: string;
  repeat: MaintenanceRepeat['every'] | '';
  weekdays: number[];
  dayOfMonth: string;
  until: Date | undefined;
  timeZone: string;
};

type ValidForm = MaintenanceFormData & { start: Date };

function formFrom(maintenance?: Maintenance): MaintenanceFormData {
  const repeat = maintenance?.repeat;
  return {
    title: maintenance?.title ?? '',
    body: maintenance?.body ?? '',
    start: maintenance ? new Date(maintenance.start) : undefined,
    end: maintenance?.end ? new Date(maintenance.end) : undefined,
    monitors: maintenance?.monitors ?? [],
    color: maintenance?.color ?? 'yellow',
    repeat: repeat?.every ?? '',
    weekdays: repeat?.weekdays ?? [],
    dayOfMonth: repeat?.dayOfMonth?.toString() ?? '',
    until: repeat?.until === undefined ? undefined : new Date(repeat.until),
    timeZone: repeat?.timeZone ?? '',
  };
}

function toRepeat(form: MaintenanceFormData): MaintenanceRepeat | undefined {
  if (!form.repeat) return undefined;
  return {
    every: form.repeat,
    weekdays: form.repeat === 'week' && form.weekdays.length ? form.weekdays : undefined,
    dayOfMonth:
      form.repeat === 'month' && form.dayOfMonth.trim() ? Number(form.dayOfMonth) : undefined,
    until: form.until?.toISOString(),
    timeZone: form.timeZone.trim() || undefined,
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
    repeat: toRepeat(form),
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
    repeat: toRepeat(form) ?? null,
  };
}

function toggled<T>(list: T[], item: T): T[] {
  return list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
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
    setFormData((prev) => ({ ...prev, monitors: toggled(prev.monitors, monitorId) }));
  }

  function toggleWeekday(day: number) {
    setFormData((prev) => ({ ...prev, weekdays: toggled(prev.weekdays, day) }));
  }

  const { start } = formData;
  const result = start ? normalizeMaintenance(toMaintenanceConfig({ ...formData, start })) : null;
  const isValid = result !== null && 'value' in result;
  // Before the description is in, the only complaint would be that it is missing.
  const error = result && 'error' in result && formData.body.trim() ? result.error : null;

  return { formData, updateField, toggleMonitor, toggleWeekday, error, isValid };
}
