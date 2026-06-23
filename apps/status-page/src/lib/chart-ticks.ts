const MIN = 60_000;
const HOUR = 60 * MIN;

// The "round" intervals people read time by, in ms.
const CANONICAL_STEPS = [
  MIN,
  2 * MIN,
  5 * MIN,
  10 * MIN,
  15 * MIN,
  30 * MIN,
  HOUR,
  2 * HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  24 * HOUR,
];

const FINE_TARGET = 7;

// Canonical step closest (by ratio) to the ideal, so labels land on round times.
function nearestCanonical(idealMs: number): number {
  let best = MIN;
  for (const step of CANONICAL_STEPS) {
    if (Math.abs(Math.log(step / idealMs)) < Math.abs(Math.log(best / idealMs))) best = step;
  }
  return best;
}

// Epoch-aligned ticks at `stepMs` within [domainMin, domainMax] (inclusive).
function ticksAtStep(domainMin: number, domainMax: number, stepMs: number): number[] {
  if (stepMs <= 0) return [];
  const start = Math.floor(domainMin / stepMs) * stepMs;
  const end = Math.ceil(domainMax / stepMs) * stepMs;
  const out: number[] = [];
  for (let v = start; v <= end; v += stepMs) {
    if (v >= domainMin && v <= domainMax) out.push(v);
  }
  return out;
}

export interface TimeTicks {
  // Epoch-ms ticks at the fine canonical step (~FINE_TARGET of them).
  ticks: number[];
  // 2x the fine step; ticks on this boundary are the rounder, always-shown subset.
  coarseStep: number;
}

/**
 * Smallest canonical step at least 2x the fine one and an exact multiple of it, so the
 * coarse (always-shown) labels nest inside the fine ones and still land on round times.
 */
function coarseMultiple(fineStep: number): number {
  for (const step of CANONICAL_STEPS) {
    if (step >= 2 * fineStep && step % fineStep === 0) return step;
  }
  return fineStep * 2;
}

/**
 * Pick canonical x-axis ticks for [domainMin, domainMax]: a fine step aiming for ~7 labels,
 * plus a coarser step for the subset kept on narrow widths.
 */
export function timeTicks(domainMin: number, domainMax: number): TimeTicks {
  const fineStep = nearestCanonical((domainMax - domainMin) / FINE_TARGET);
  return {
    ticks: ticksAtStep(domainMin, domainMax, fineStep),
    coarseStep: coarseMultiple(fineStep),
  };
}
