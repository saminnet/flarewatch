import { useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { line, curveMonotoneX } from 'd3-shape';
import type { MonitorState } from '@flarewatch/shared';
import type { PublicMonitor } from '@/lib/monitors';
import { formatColoLabel } from '@/lib/cf-colos';
import { linearScale, niceLinearTicks } from '@/lib/chart-scale';
import { timeTicks } from '@/lib/chart-ticks';
import { formatUtc } from '@/lib/date';
import { CHART_HEIGHT_PX } from '@/lib/constants';

interface LatencyChartProps {
  monitor: PublicMonitor;
  state: MonitorState;
}

type ChartPoint = {
  timeMs: number;
  ping: number;
  loc: string;
};

/**
 * The chart never measures its width, so the server and client render the same markup.
 * The line and grid are SVG in a fixed 0..VB viewBox stretched to fill the plot box
 * (preserveAspectRatio="none"); vector-effect keeps strokes at 1px at any width. Labels,
 * the hover dot, and the tooltip are HTML overlays placed by percent, which keeps text
 * crisp. x-axis labels fall on round times; the in-between ones drop out on narrow widths
 * via container queries (styles.css).
 */
const VB = 100;
const PADDING_TOP_PX = 5;
const X_AXIS_HEIGHT_PX = 20;
const LINE_COLOR = '#6b7280';
const AXIS_TEXT_COLOR = '#9ca3af';
const GRID_COLOR = '#e5e7eb';

// Fraction (0..1) of the plot box -> CSS percentage for an HTML overlay.
const pct = (frac: number) => `${frac * 100}%`;

// Anchor labels near the edges inward so they don't overflow the plot box.
function xLabelTransform(frac: number): string {
  if (frac < 0.08) return 'translateX(0)';
  if (frac > 0.92) return 'translateX(-100%)';
  return 'translateX(-50%)';
}

// Nearest data point to a time value via binary search (data is time-ordered).
function nearestIndex(data: ChartPoint[], t: number): number {
  let lo = 0;
  let hi = data.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    const point = data[mid];
    if (point && point.timeMs < t) lo = mid + 1;
    else hi = mid;
  }
  const prev = data[lo - 1];
  const cur = data[lo];
  if (prev && cur && Math.abs(prev.timeMs - t) <= Math.abs(cur.timeMs - t)) return lo - 1;
  return lo;
}

function ChartTooltip({ point, xFrac }: { point: ChartPoint; xFrac: number }) {
  const coloLabel = formatColoLabel(point.loc);
  const style: CSSProperties =
    xFrac > 0.5
      ? { right: `${(1 - xFrac) * 100}%`, marginRight: 8, top: 4 }
      : { left: `${xFrac * 100}%`, marginLeft: 8, top: 4 };

  return (
    <div
      className="pointer-events-none absolute z-10 rounded border border-border bg-popover px-2 py-1.5 text-xs shadow-sm"
      style={style}
    >
      <div className="font-medium text-popover-foreground">{point.ping}ms</div>
      <div className="text-muted-foreground">{coloLabel || point.loc}</div>
      <div className="text-muted-foreground">
        {formatUtc(new Date(point.timeMs), 'MMM d, HH:mm')}
      </div>
    </div>
  );
}

function SvgLatencyChart({ chartData }: { chartData: ChartPoint[] }) {
  const { t } = useTranslation();
  const plotRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const times = chartData.map((d) => d.timeMs);
  const xDomain: [number, number] = [Math.min(...times), Math.max(...times)];
  const maxPing = Math.max(...chartData.map((d) => d.ping), 0);
  const yAxisWidth = maxPing >= 10000 ? 60 : maxPing >= 1000 ? 50 : 40;
  const { ticks: xTicks, coarseStep } = timeTicks(xDomain[0], xDomain[1]);

  const last = chartData[chartData.length - 1];
  const ariaLabel = last
    ? t('monitor.responseTimesChart', {
        ping: last.ping,
        loc: formatColoLabel(last.loc) || last.loc,
      })
    : t('monitor.responseTimes');

  const xScale = linearScale(xDomain, [0, VB]);
  const { ticks: yTicks, max: yMax } = niceLinearTicks(maxPing);
  const yScale = linearScale([0, yMax], [VB, 0]);
  /**
   * Ticks on a coarse-step boundary are always shown (tier 0); the in-between ones
   * (tier 1) hide on narrow widths via container queries. See styles.css.
   */
  const xTier = (tick: number) => (tick % coarseStep === 0 ? 0 : 1);

  const linePath =
    line<ChartPoint>()
      .x((d) => xScale(d.timeMs))
      .y((d) => yScale(d.ping))
      .curve(curveMonotoneX)(chartData) ?? '';

  const activePoint = activeIndex === null ? null : chartData[activeIndex];
  const fracX = (timeMs: number) => xScale(timeMs) / VB;
  const fracY = (ping: number) => yScale(ping) / VB;
  const activeXFrac = activePoint ? fracX(activePoint.timeMs) : 0;

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!plotRef.current) return;
    const rect = plotRef.current.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setActiveIndex(nearestIndex(chartData, xDomain[0] + frac * (xDomain[1] - xDomain[0])));
  }

  return (
    <div
      className="relative touch-pan-y"
      style={{ height: CHART_HEIGHT_PX }}
      data-testid="latency-chart"
      role="img"
      aria-label={ariaLabel}
      onPointerDown={handlePointerMove}
      onPointerMove={handlePointerMove}
      onPointerUp={() => setActiveIndex(null)}
      onPointerLeave={() => setActiveIndex(null)}
      onPointerCancel={() => setActiveIndex(null)}
    >
      <div
        ref={plotRef}
        className="absolute"
        style={{
          left: yAxisWidth,
          right: 0,
          top: PADDING_TOP_PX,
          bottom: X_AXIS_HEIGHT_PX,
          containerType: 'inline-size',
        }}
      >
        <svg
          viewBox={`0 0 ${VB} ${VB}`}
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full overflow-visible"
          aria-hidden="true"
        >
          {yTicks.map((tick) => (
            <line
              key={`h-${tick}`}
              x1={0}
              x2={VB}
              y1={yScale(tick)}
              y2={yScale(tick)}
              stroke={GRID_COLOR}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              className="dark:stroke-neutral-700"
            />
          ))}
          {xTicks.map((tick) => (
            <line
              key={`v-${tick}`}
              data-chart-tier={xTier(tick)}
              x1={xScale(tick)}
              x2={xScale(tick)}
              y1={0}
              y2={VB}
              stroke={GRID_COLOR}
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              className="dark:stroke-neutral-700"
            />
          ))}

          <line
            x1={0}
            x2={VB}
            y1={VB}
            y2={VB}
            stroke={GRID_COLOR}
            vectorEffect="non-scaling-stroke"
            className="dark:stroke-neutral-700"
          />

          {activePoint && (
            <line
              x1={xScale(activePoint.timeMs)}
              x2={xScale(activePoint.timeMs)}
              y1={0}
              y2={VB}
              stroke={AXIS_TEXT_COLOR}
              vectorEffect="non-scaling-stroke"
            />
          )}

          <path
            d={linePath}
            fill="none"
            stroke={LINE_COLOR}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {activePoint && (
          <span
            className="pointer-events-none absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: pct(activeXFrac),
              top: pct(fracY(activePoint.ping)),
              background: LINE_COLOR,
            }}
          />
        )}

        {yTicks.map((tick) => (
          <span
            key={`yl-${tick}`}
            className="pointer-events-none absolute -translate-y-1/2 text-[10px] leading-none whitespace-nowrap"
            style={{ top: pct(fracY(tick)), right: '100%', marginRight: 4, color: AXIS_TEXT_COLOR }}
          >
            {`${tick}ms`}
          </span>
        ))}
        {xTicks.map((tick) => (
          <span
            key={`xl-${tick}`}
            data-chart-tier={xTier(tick)}
            className="pointer-events-none absolute top-full mt-1 text-[10px] leading-none whitespace-nowrap"
            style={{
              left: pct(fracX(tick)),
              transform: xLabelTransform(fracX(tick)),
              color: AXIS_TEXT_COLOR,
            }}
          >
            {formatUtc(new Date(tick), 'HH:mm')}
          </span>
        ))}

        {activePoint && <ChartTooltip point={activePoint} xFrac={activeXFrac} />}
      </div>
    </div>
  );
}

export function LatencyChart({ monitor, state }: LatencyChartProps) {
  const { t } = useTranslation();
  const recentLatency = state.latency[monitor.id]?.recent;

  const chartData: ChartPoint[] = (recentLatency ?? []).map((point) => ({
    timeMs: point.time * 1000,
    ping: point.ping,
    loc: point.loc,
  }));

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

  return <SvgLatencyChart chartData={chartData} />;
}
