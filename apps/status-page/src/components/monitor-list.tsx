import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
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
import { qk } from '@/lib/query/keys';

interface MonitorListProps {
  monitors: PublicMonitor[];
  state: MonitorState;
  groups?: PageConfigGroup;
  uiPrefs?: UiPrefs;
}

export function MonitorList({ monitors, state, groups, uiPrefs }: MonitorListProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [collapsedMonitors, setCollapsedMonitors] = useState<string[]>(
    () => uiPrefs?.collapsedMonitors ?? [],
  );
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(
    () => uiPrefs?.collapsedGroups ?? [],
  );

  // Track if this is the initial mount to avoid persisting on load
  const isInitialMount = useRef(true);

  const persistPrefs = useCallback(
    (next: UiPrefs) => {
      queryClient.setQueryData(qk.uiPrefs, next);
      void setUiPrefsServerFn({ data: next });
    },
    [queryClient],
  );

  // Persist preferences when state changes (but not on initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    persistPrefs({ collapsedGroups, collapsedMonitors });
  }, [collapsedGroups, collapsedMonitors, persistPrefs]);

  const onMonitorOpenChange = useCallback((monitorId: string, open: boolean) => {
    setCollapsedMonitors((prev) => {
      const nextSet = new Set(prev);
      if (open) {
        nextSet.delete(monitorId);
      } else {
        nextSet.add(monitorId);
      }
      return Array.from(nextSet);
    });
  }, []);

  // Filter groups to only those with monitors that actually exist
  const activeGroups = useMemo(() => {
    if (!groups) return [];
    return Object.entries(groups)
      .map(([name, ids]) => ({
        name,
        monitors: ids
          .map((id) => monitors.find((m) => m.id === id))
          .filter((m): m is PublicMonitor => m !== undefined),
      }))
      .filter((g) => g.monitors.length > 0);
  }, [groups, monitors]);

  // Find monitors not in any active group
  const ungroupedMonitors = useMemo(() => {
    const groupedMonitorIds = new Set(activeGroups.flatMap((g) => g.monitors.map((m) => m.id)));
    return monitors.filter((m) => !groupedMonitorIds.has(m.id));
  }, [activeGroups, monitors]);

  // If no active groups exist, render as flat list (no labels needed)
  if (activeGroups.length === 0) {
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

  const activeGroupNames = useMemo(() => activeGroups.map((g) => g.name), [activeGroups]);
  const openGroupNames = useMemo(
    () => activeGroupNames.filter((name) => !collapsedGroups.includes(name)),
    [activeGroupNames, collapsedGroups],
  );

  return (
    <div className="space-y-4">
      {/* Ungrouped monitors shown FIRST, without label */}
      {ungroupedMonitors.length > 0 && (
        <div className="space-y-3">
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

      {/* Groups shown after ungrouped monitors */}
      <Accordion
        multiple
        value={openGroupNames}
        onValueChange={(value) => {
          const open = value.filter((v): v is string => typeof v === 'string');
          const nextCollapsed = activeGroupNames.filter((name) => !open.includes(name));
          setCollapsedGroups(nextCollapsed);
        }}
        className="space-y-3"
      >
        {activeGroups.map(({ name: groupName, monitors: groupMonitors }) => (
          <AccordionItem key={groupName} value={groupName} className="border rounded-lg">
            <AccordionTrigger
              className="px-4 py-3 hover:no-underline hover:bg-neutral-50 dark:hover:bg-neutral-900 rounded-lg"
              aria-label={t('monitor.toggleGroup', {
                name: groupName,
                count: groupMonitors.length,
              })}
            >
              <div className="flex items-center gap-2">
                <span className="font-medium">{groupName}</span>
                <span className="text-sm text-neutral-500 dark:text-neutral-400">
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
        ))}
      </Accordion>
    </div>
  );
}
