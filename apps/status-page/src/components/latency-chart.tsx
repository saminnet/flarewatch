import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import type { MonitorState } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/monitors';
import { formatColoLabel } from '@/lib/cf-colos';

const CHART_HEIGHT_PX = 150;

interface LatencyChartProps {
  monitor: PublicMonitor;
  state: MonitorState;
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    payload: {
      timeMs: number;
      ping: number;
      loc: string;
    };
  }>;
}

type ChartPoint = {
  timeMs: number;
  ping: number;
  loc: string;
};

interface RechartsLatencyChartProps {
  chartData: ChartPoint[];
  yAxisWidth: number;
  xDomain: [number, number] | undefined;
  xTicks: number[] | undefined;
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload || !payload[0]) return null;

  const data = payload[0].payload;
  const coloLabel = formatColoLabel(data.loc);

  return (
    <div className="rounded border border-border bg-popover px-2 py-1.5 text-xs shadow-sm">
      <div className="font-medium text-popover-foreground">{data.ping}ms</div>
      <div className="text-muted-foreground">{coloLabel || data.loc}</div>
      <div className="text-muted-foreground">{format(new Date(data.timeMs), 'MMM d, HH:mm')}</div>
    </div>
  );
}

const RechartsLatencyChart = lazy(async () => {
  const { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } =
    await import('recharts');

  return {
    default: function RechartsLatencyChart({
      chartData,
      yAxisWidth,
      xDomain,
      xTicks,
    }: RechartsLatencyChartProps) {
      return (
        <ResponsiveContainer width="100%" height={CHART_HEIGHT_PX}>
          <LineChart data={chartData} margin={{ top: 5, right: 0, bottom: 0, left: 0 }}>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="#e5e7eb"
              className="dark:stroke-neutral-700"
              horizontal={true}
              vertical={true}
            />
            <XAxis
              dataKey="timeMs"
              type="number"
              domain={xDomain}
              ticks={xTicks}
              allowDataOverflow={true}
              tickFormatter={(value) => format(new Date(value), 'HH:mm')}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={{ stroke: '#e5e7eb' }}
              tickLine={false}
            />
            <YAxis
              tickFormatter={(value) => `${value}ms`}
              tick={{ fontSize: 10, fill: '#9ca3af' }}
              axisLine={false}
              tickLine={false}
              width={yAxisWidth}
            />
            <Tooltip content={<CustomTooltip />} />
            <Line
              type="monotone"
              dataKey="ping"
              stroke="#6b7280"
              strokeWidth={1.2}
              dot={false}
              activeDot={{ r: 3, fill: '#6b7280' }}
            />
          </LineChart>
        </ResponsiveContainer>
      );
    },
  };
});

function floorToStep(valueMs: number, stepMs: number): number {
  return Math.floor(valueMs / stepMs) * stepMs;
}

function ceilToStep(valueMs: number, stepMs: number): number {
  return Math.ceil(valueMs / stepMs) * stepMs;
}

function chooseTickStepMs(rangeMs: number): number {
  const minute = 60_000;
  const hour = 60 * minute;

  if (rangeMs <= 2 * hour) return 10 * minute;
  if (rangeMs <= 6 * hour) return 30 * minute;
  if (rangeMs <= 12 * hour) return 1 * hour;
  return 2 * hour;
}

export function LatencyChart({ monitor, state }: LatencyChartProps) {
  const { t } = useTranslation();
  const recentLatency = state.latency[monitor.id]?.recent;

  const chartData = (recentLatency ?? []).map((point) => ({
    timeMs: point.time * 1000,
    ping: point.ping,
    loc: point.loc,
  }));

  const domainMin = chartData[0]?.timeMs;
  const domainMax = chartData[chartData.length - 1]?.timeMs;

  const maxPing = Math.max(...chartData.map((d) => d.ping), 0);
  const yAxisWidth = maxPing >= 10000 ? 60 : maxPing >= 1000 ? 50 : 40;

  const tickStepMs =
    domainMin !== undefined && domainMax !== undefined
      ? chooseTickStepMs(domainMax - domainMin)
      : 0;

  const xDomain: [number, number] | undefined =
    domainMin !== undefined && domainMax !== undefined ? [domainMin, domainMax] : undefined;

  const xTicks =
    domainMin === undefined || domainMax === undefined || tickStepMs <= 0
      ? undefined
      : (() => {
          const tickStart = floorToStep(domainMin, tickStepMs);
          const tickEnd = ceilToStep(domainMax, tickStepMs);
          const allTicks = Array.from(
            { length: Math.floor((tickEnd - tickStart) / tickStepMs) + 1 },
            (_, i) => tickStart + i * tickStepMs,
          );
          return allTicks.filter((tick) => tick >= domainMin && tick <= domainMax);
        })();

  if (chartData.length === 0) {
    return (
      <div
        className="flex w-full items-center justify-center rounded-md border border-dashed border-neutral-200 dark:border-neutral-800"
        style={{ height: CHART_HEIGHT_PX }}
      >
        <span className="text-xs text-neutral-400">{t('monitor.noResponseData')}</span>
      </div>
    );
  }

  return (
    <Suspense
      fallback={
        <div
          className="w-full rounded-md border border-dashed border-neutral-200 dark:border-neutral-800"
          style={{ height: CHART_HEIGHT_PX }}
        />
      }
    >
      <RechartsLatencyChart
        chartData={chartData}
        yAxisWidth={yAxisWidth}
        xDomain={xDomain}
        xTicks={xTicks}
      />
    </Suspense>
  );
}
