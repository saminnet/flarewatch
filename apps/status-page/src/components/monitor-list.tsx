import { useEffect, useRef, useState } from 'react';
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

  const isInitialMount = useRef(true);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    const next = { collapsedGroups, collapsedMonitors };
    queryClient.setQueryData(qk.uiPrefs, next);
    void setUiPrefsServerFn({ data: next });
  }, [collapsedGroups, collapsedMonitors, queryClient]);

  function onMonitorOpenChange(monitorId: string, open: boolean) {
    setCollapsedMonitors((prev) => {
      const nextSet = new Set(prev);
      if (open) {
        nextSet.delete(monitorId);
      } else {
        nextSet.add(monitorId);
      }
      return Array.from(nextSet);
    });
  }

  function renderMonitorCard(monitor: PublicMonitor, index: number) {
    return (
      <MonitorCard
        key={monitor.id}
        monitor={monitor}
        state={state}
        open={!collapsedMonitors.includes(monitor.id)}
        onOpenChange={(open) => onMonitorOpenChange(monitor.id, open)}
        className="animate-fade-in-up opacity-0"
        style={{ animationDelay: `${index * 30}ms` }}
      />
    );
  }

  const activeGroups: Array<{ name: string; monitors: PublicMonitor[] }> = [];
  if (groups) {
    const monitorById = new Map(monitors.map((monitor) => [monitor.id, monitor]));

    for (const [name, ids] of Object.entries(groups)) {
      const groupMonitors: PublicMonitor[] = [];
      for (const id of ids) {
        const monitor = monitorById.get(id);
        if (monitor) groupMonitors.push(monitor);
      }

      if (groupMonitors.length > 0) {
        activeGroups.push({ name, monitors: groupMonitors });
      }
    }
  }

  const groupedMonitorIds = new Set(activeGroups.flatMap((g) => g.monitors.map((m) => m.id)));
  const ungroupedMonitors = monitors.filter((m) => !groupedMonitorIds.has(m.id));

  const activeGroupNames = activeGroups.map((g) => g.name);
  const collapsedGroupNames = new Set(collapsedGroups);
  const openGroupNames = activeGroupNames.filter((name) => !collapsedGroupNames.has(name));

  // If no active groups exist, render as flat list (no labels needed)
  if (activeGroups.length === 0) {
    return <div className="space-y-2">{monitors.map(renderMonitorCard)}</div>;
  }

  return (
    <div className="space-y-3">
      {ungroupedMonitors.length > 0 && (
        <div className="space-y-2">{ungroupedMonitors.map(renderMonitorCard)}</div>
      )}

      <Accordion
        multiple
        value={openGroupNames}
        onValueChange={(value) => {
          const open = value.filter((v): v is string => typeof v === 'string');
          const nextCollapsed = activeGroupNames.filter((name) => !open.includes(name));
          setCollapsedGroups(nextCollapsed);
        }}
        className="space-y-2"
      >
        {activeGroups.map(({ name: groupName, monitors: groupMonitors }) => (
          <AccordionItem key={groupName} value={groupName} className="border rounded-lg">
            <AccordionTrigger
              className="px-3 py-2.5 hover:no-underline hover:bg-neutral-50 dark:hover:bg-neutral-900 rounded-lg"
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
            <AccordionContent className="px-3 pb-3 pt-1.5">
              <div className="space-y-2">{groupMonitors.map(renderMonitorCard)}</div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}
