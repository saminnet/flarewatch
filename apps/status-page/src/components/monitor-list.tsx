import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { MonitorCard } from '@/components/monitor-card';
import type { MonitorState, PageConfigGroup } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/monitors';
import { setUiPrefsServerFn, type UiPrefs } from '@/lib/ui-prefs-server';

interface MonitorListProps {
  monitors: PublicMonitor[];
  state: MonitorState;
  groups?: PageConfigGroup;
  uiPrefs?: UiPrefs;
}

export function MonitorList({ monitors, state, groups, uiPrefs }: MonitorListProps) {
  const { t } = useTranslation();
  const [collapsedMonitors, setCollapsedMonitors] = useState<string[]>(
    () => uiPrefs?.collapsedMonitors ?? [],
  );
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(
    () => uiPrefs?.collapsedGroups ?? [],
  );

  const persistPrefs = useCallback((next: UiPrefs) => {
    void setUiPrefsServerFn({ data: next });
  }, []);

  const onMonitorOpenChange = useCallback(
    (monitorId: string, open: boolean) => {
      setCollapsedMonitors((prev) => {
        const nextSet = new Set(prev);
        if (open) {
          nextSet.delete(monitorId);
        } else {
          nextSet.add(monitorId);
        }

        const next = Array.from(nextSet);
        persistPrefs({ collapsedGroups, collapsedMonitors: next });
        return next;
      });
    },
    [collapsedGroups, persistPrefs],
  );

  if (!groups || Object.keys(groups).length === 0) {
    return (
      <div className="space-y-3">
        {monitors.map((monitor) => (
          <MonitorCard
            key={monitor.id}
            monitor={monitor}
            state={state}
            open={!collapsedMonitors.includes(monitor.id)}
            onOpenChange={(open) => onMonitorOpenChange(monitor.id, open)}
          />
        ))}
      </div>
    );
  }

  const allGroupNames = useMemo(() => Object.keys(groups), [groups]);
  const openGroupNames = useMemo(
    () => allGroupNames.filter((name) => !collapsedGroups.includes(name)),
    [allGroupNames, collapsedGroups],
  );

  const groupedMonitorIds = new Set(Object.values(groups).flat());
  const ungroupedMonitors = monitors.filter((m) => !groupedMonitorIds.has(m.id));

  return (
    <div className="space-y-4">
      <Accordion
        multiple
        value={openGroupNames}
        onValueChange={(value) => {
          const open = value.filter((v): v is string => typeof v === 'string');
          const nextCollapsed = allGroupNames.filter((name) => !open.includes(name));
          setCollapsedGroups(nextCollapsed);
          persistPrefs({ collapsedGroups: nextCollapsed, collapsedMonitors });
        }}
        className="space-y-3"
      >
        {Object.entries(groups).map(([groupName, monitorIds]) => {
          const groupMonitors = monitorIds
            .map((id) => monitors.find((m) => m.id === id))
            .filter((m): m is PublicMonitor => m !== undefined);

          if (groupMonitors.length === 0) return null;

          return (
            <AccordionItem key={groupName} value={groupName} className="border rounded-lg">
              <AccordionTrigger
                className="px-4 py-3 hover:no-underline hover:bg-neutral-50 dark:hover:bg-neutral-900 rounded-lg"
                aria-label={'Toggle ' + groupName + ' monitors'}
              >
                <div className="flex items-center gap-2">
                  <span className="font-medium">{groupName}</span>
                  <span className="text-sm text-neutral-500">
                    ({t('monitor.count', { count: groupMonitors.length })})
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 pb-4 pt-2">
                <div className="space-y-3">
                  {groupMonitors.map((monitor) => (
                    <MonitorCard
                      key={monitor.id}
                      monitor={monitor}
                      state={state}
                      open={!collapsedMonitors.includes(monitor.id)}
                      onOpenChange={(open) => onMonitorOpenChange(monitor.id, open)}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>

      {ungroupedMonitors.length > 0 && (
        <div className="space-y-3">
          {Object.keys(groups).length > 0 && (
            <h3 className="text-sm font-medium text-neutral-500 px-1">{t('monitor.other')}</h3>
          )}
          {ungroupedMonitors.map((monitor) => (
            <MonitorCard
              key={monitor.id}
              monitor={monitor}
              state={state}
              open={!collapsedMonitors.includes(monitor.id)}
              onOpenChange={(open) => onMonitorOpenChange(monitor.id, open)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
