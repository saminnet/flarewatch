import { useState, useCallback, useMemo } from 'react';
import type { Maintenance } from '@flarewatch/shared';

export type MaintenanceFormData = {
  title: string;
  body: string;
  start: Date | undefined;
  end: Date | undefined;
  monitors: string[];
  color: string;
};

const DEFAULT_FORM: MaintenanceFormData = {
  title: '',
  body: '',
  start: undefined,
  end: undefined,
  monitors: [],
  color: 'yellow',
};

export function useMaintenanceForm() {
  const [formData, setFormData] = useState<MaintenanceFormData>(DEFAULT_FORM);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const resetForm = useCallback(() => {
    setFormData(DEFAULT_FORM);
    setErrorMessage(null);
  }, []);

  const updateField = useCallback(
    <K extends keyof MaintenanceFormData>(field: K, value: MaintenanceFormData[K]) => {
      setFormData((prev) => ({ ...prev, [field]: value }));
    },
    [],
  );

  const toggleMonitor = useCallback((monitorId: string) => {
    setFormData((prev) => {
      const current = prev.monitors;
      if (current.includes(monitorId)) {
        return { ...prev, monitors: current.filter((id) => id !== monitorId) };
      }
      return { ...prev, monitors: [...current, monitorId] };
    });
  }, []);

  const populateFromMaintenance = useCallback((maintenance: Maintenance) => {
    setFormData({
      title: maintenance.title ?? '',
      body: maintenance.body,
      start: new Date(maintenance.start),
      end: maintenance.end ? new Date(maintenance.end) : undefined,
      monitors: maintenance.monitors ?? [],
      color: maintenance.color ?? 'yellow',
    });
    setErrorMessage(null);
  }, []);

  const isEndBeforeStart = useMemo(
    () =>
      Boolean(formData.start && formData.end && formData.end.getTime() < formData.start.getTime()),
    [formData.start, formData.end],
  );

  const isValid = useMemo(
    () => formData.body.trim() !== '' && formData.start !== undefined && !isEndBeforeStart,
    [formData.body, formData.start, isEndBeforeStart],
  );

  return {
    formData,
    errorMessage,
    setErrorMessage,
    resetForm,
    updateField,
    toggleMonitor,
    populateFromMaintenance,
    isEndBeforeStart,
    isValid,
  };
}
