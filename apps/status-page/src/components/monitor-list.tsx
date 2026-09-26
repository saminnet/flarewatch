import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { IconWorld, IconClockPlay } from '@tabler/icons-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { MonitorCard } from '@/components/monitor-card';
import type { MonitorState, PageConfigGroup } from '@flarewatch/shared';
import type { AdminMonitor } from '@/lib/public-view';
import { setUiPrefsServerFn, type UiPrefs } from '@/lib/ui-prefs-server';
import { qk } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

export type MonitorKindFilter = 'web' | 'jobs';

/** Key the default heartbeat group uses in collapsedGroups; never a config group name. */
const SCHEDULED_JOBS_GROUP_KEY = '__scheduled_jobs__';

/** Concentric with the rounded-lg cards inside, which sit px-3 from the group edge. */
const GROUP_RADIUS = 'rounded-[calc(var(--radius-lg)+--spacing(3))]';

interface MonitorGroup {
  key: string;
  name: string;
  monitors: AdminMonitor[];
}

interface MonitorListProps {
  monitors: AdminMonitor[];
  state: MonitorState;
  groups?: PageConfigGroup;
  uiPrefs?: UiPrefs;
  pingUrlSlot?: (monitor: AdminMonitor) => ReactNode;
  kind?: MonitorKindFilter;
  onKindChange?: (kind: MonitorKindFilter | undefined) => void;
}

export function MonitorList({
  monitors,
  state,
  groups,
  uiPrefs,
  pingUrlSlot,
  kind,
  onKindChange,
}: MonitorListProps) {
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

  function renderMonitorCard(monitor: AdminMonitor, index: number) {
    return (
      <MonitorCard
        key={monitor.id}
        monitor={monitor}
        state={state}
        open={!collapsedMonitors.includes(monitor.id)}
        onOpenChange={(open) => onMonitorOpenChange(monitor.id, open)}
        pingUrlSlot={pingUrlSlot?.(monitor)}
        className="animate-fade-in-up opacity-0"
        style={{ animationDelay: `${index * 30}ms` }}
      />
    );
  }

  const hasHeartbeats = monitors.some((monitor) => monitor.method === 'HEARTBEAT');
  const hasPulls = monitors.some((monitor) => monitor.method !== 'HEARTBEAT');
  const hasBothKinds = hasHeartbeats && hasPulls;
  const filterActive = Boolean(onKindChange && hasBothKinds);

  const isHeartbeat = (monitor: AdminMonitor) => monitor.method === 'HEARTBEAT';
  const matchesKind = (monitor: AdminMonitor) =>
    !filterActive || !kind || (kind === 'jobs') === isHeartbeat(monitor);

  const activeGroups: MonitorGroup[] = [];
  const monitorById = new Map(monitors.map((monitor) => [monitor.id, monitor]));
  const groupedMonitorIds = new Set<string>();

  if (groups) {
    for (const [name, ids] of Object.entries(groups)) {
      const groupMonitors = ids
        .map((id) => monitorById.get(id))
        .filter(
          (monitor): monitor is AdminMonitor => monitor !== undefined && matchesKind(monitor),
        );

      for (const id of ids) groupedMonitorIds.add(id);

      if (groupMonitors.length > 0) {
        activeGroups.push({ key: name, name, monitors: groupMonitors });
      }
    }
  }

  const ungroupedMonitors = monitors.filter(
    (monitor) => !groupedMonitorIds.has(monitor.id) && matchesKind(monitor),
  );

  if (hasBothKinds) {
    const scheduledJobs = ungroupedMonitors.filter(isHeartbeat);
    if (scheduledJobs.length > 0) {
      activeGroups.push({
        key: SCHEDULED_JOBS_GROUP_KEY,
        name: 'Scheduled jobs',
        monitors: scheduledJobs,
      });
    }
  }

  const flatMonitors = hasBothKinds
    ? ungroupedMonitors.filter((monitor) => !isHeartbeat(monitor))
    : ungroupedMonitors;

  const activeGroupKeys = activeGroups.map((group) => group.key);
  const collapsedGroupKeys = new Set(collapsedGroups);
  const openGroupKeys = activeGroupKeys.filter((key) => !collapsedGroupKeys.has(key));

  return (
    <div className="space-y-3">
      {filterActive && (
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[kind ?? 'all']}
          onValueChange={(value) => {
            const selected = Array.isArray(value) ? value[0] : value;
            onKindChange?.(selected === 'web' || selected === 'jobs' ? selected : undefined);
          }}
          aria-label="Filter monitors by kind"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="web">
            <IconWorld aria-hidden="true" />
            Websites
          </ToggleGroupItem>
          <ToggleGroupItem value="jobs">
            <IconClockPlay aria-hidden="true" />
            Scheduled jobs
          </ToggleGroupItem>
        </ToggleGroup>
      )}

      {activeGroups.length === 0 ? (
        <div className="space-y-2">{flatMonitors.map(renderMonitorCard)}</div>
      ) : (
        <>
          {flatMonitors.length > 0 && (
            <div className="space-y-2">{flatMonitors.map(renderMonitorCard)}</div>
          )}

          <Accordion
            multiple
            value={openGroupKeys}
            onValueChange={(value) => {
              const open = new Set(value.filter((v): v is string => typeof v === 'string'));
              const nextCollapsed = activeGroupKeys.filter((key) => !open.has(key));
              setCollapsedGroups(nextCollapsed);
            }}
            className="space-y-2"
          >
            {activeGroups.map(({ key, name, monitors: groupMonitors }) => {
              const count = groupMonitors.length;
              const countLabel = groupMonitors.every(isHeartbeat)
                ? `${count} ${count === 1 ? 'job' : 'jobs'}`
                : `${count} ${count === 1 ? 'monitor' : 'monitors'}`;
              return (
                <AccordionItem key={key} value={key} className={cn('border', GROUP_RADIUS)}>
                  <AccordionTrigger
                    className={cn('px-3 py-2.5 hover:no-underline hover:bg-muted/50', GROUP_RADIUS)}
                    aria-label={`Toggle ${name} (${countLabel})`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{name}</span>
                      <span className="text-sm text-muted-foreground">({countLabel})</span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="px-3 pb-3 pt-1.5">
                    <div className="space-y-2">{groupMonitors.map(renderMonitorCard)}</div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </>
      )}
    </div>
  );
}
