/**
 * Linear scale + nice-tick helpers ported from d3-scale/d3-array, so the chart needs only
 * d3-shape (curveMonotoneX) and not the heavier d3-scale tree (d3-interpolate, d3-format,
 * d3-color). Output matches scaleLinear().domain([0, max]).nice().ticks(5); the golden
 * values in chart-scale.test.ts lock that down.
 */

export interface LinearScale {
  (value: number): number;
  invert: (px: number) => number;
}

// Maps domain [d0, d1] onto range [r0, r1].
export function linearScale([d0, d1]: [number, number], [r0, r1]: [number, number]): LinearScale {
  const span = d1 - d0 || 1; // degenerate domain -> avoid divide-by-zero
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  scale.invert = (px: number) => d0 + ((px - r0) / (r1 - r0)) * span;
  return scale;
}

const E10 = Math.sqrt(50);
const E5 = Math.sqrt(10);
const E2 = Math.sqrt(2);

// d3-array tickSpec: [i1, i2, inc] describing the tick run for [start, stop].
function tickSpec(start: number, stop: number, count: number): [number, number, number] {
  const rawStep = (stop - start) / Math.max(0, count);
  const power = Math.floor(Math.log10(rawStep));
  const error = rawStep / 10 ** power;
  const factor = error >= E10 ? 10 : error >= E5 ? 5 : error >= E2 ? 2 : 1;
  let i1: number;
  let i2: number;
  let inc: number;
  if (power < 0) {
    inc = 10 ** -power / factor;
    i1 = Math.round(start * inc);
    i2 = Math.round(stop * inc);
    if (i1 / inc < start) ++i1;
    if (i2 / inc > stop) --i2;
    inc = -inc;
  } else {
    inc = 10 ** power * factor;
    i1 = Math.round(start / inc);
    i2 = Math.round(stop / inc);
    if (i1 * inc < start) ++i1;
    if (i2 * inc > stop) --i2;
  }
  if (i2 < i1 && count >= 0.5 && count < 2) return tickSpec(start, stop, count * 2);
  return [i1, i2, inc];
}

function tickIncrement(start: number, stop: number, count: number): number {
  return tickSpec(start, stop, count)[2];
}

// d3-array ticks for an ascending [start, stop].
function ticks(start: number, stop: number, count: number): number[] {
  if (!(count > 0)) return [];
  if (start === stop) return [start];
  const [i1, i2, inc] = tickSpec(start, stop, count);
  if (!(i2 >= i1)) return [];
  const n = i2 - i1 + 1;
  return Array.from({ length: n }, (_, i) => (inc < 0 ? (i1 + i) / -inc : (i1 + i) * inc));
}

// scaleLinear().domain([0, maxValue]).nice() for a 0-based domain (start stays 0).
function niceMax(maxValue: number, count: number): number {
  if (!(maxValue > 0)) return maxValue;
  let stop = maxValue;
  let prestep: number | undefined;
  let maxIter = 10;
  while (maxIter-- > 0) {
    const step = tickIncrement(0, stop, count);
    if (step === prestep) break;
    if (step > 0) stop = Math.ceil(stop / step) * step;
    else if (step < 0) stop = Math.floor(stop * step) / step;
    else break;
    prestep = step;
  }
  return stop;
}

/**
 * Mirrors scaleLinear().domain([0, maxValue]).nice().ticks(5):
 * nice() uses its default count of 10; ticks() uses 5.
 */
export function niceLinearTicks(maxValue: number): { ticks: number[]; max: number } {
  const max = niceMax(maxValue, 10);
  return { ticks: ticks(0, max, 5), max };
}
