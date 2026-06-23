import { describe, expect, it } from 'vite-plus/test';
import { timeTicks } from '@/lib/chart-ticks';

const MIN = 60_000;
const HOUR = 60 * MIN;

// A deliberately non-round start, to prove ticks still land on round epoch boundaries.
const START = 9 * HOUR + 23 * MIN + 17_000;

const CASES: { label: string; range: number; fineStep: number; coarseStep: number }[] = [
  { label: '110 minutes', range: 110 * MIN, fineStep: 15 * MIN, coarseStep: 30 * MIN },
  { label: '2 hours', range: 2 * HOUR, fineStep: 15 * MIN, coarseStep: 30 * MIN },
  { label: '6 hours', range: 6 * HOUR, fineStep: HOUR, coarseStep: 2 * HOUR },
  { label: '12 hours', range: 12 * HOUR, fineStep: 2 * HOUR, coarseStep: 6 * HOUR },
  { label: '24 hours', range: 24 * HOUR, fineStep: 3 * HOUR, coarseStep: 6 * HOUR },
];

describe('timeTicks', () => {
  for (const { label, range, fineStep, coarseStep } of CASES) {
    describe(label, () => {
      const result = timeTicks(START, START + range);

      it('picks the canonical fine + coarse steps', () => {
        expect(result.coarseStep).toBe(coarseStep);
        expect(result.ticks[1]! - result.ticks[0]!).toBe(fineStep);
      });

      it('spaces ticks evenly by the fine step', () => {
        for (let i = 1; i < result.ticks.length; i++) {
          expect(result.ticks[i]! - result.ticks[i - 1]!).toBe(fineStep);
        }
      });

      it('lands every tick on a round (epoch-aligned) boundary', () => {
        for (const tick of result.ticks) expect(tick % fineStep).toBe(0);
      });

      it('nests the coarse step inside the fine ticks', () => {
        expect(result.coarseStep % fineStep).toBe(0);
      });

      it('keeps a sensible label count (5-9) with >=2 coarse anchors', () => {
        expect(result.ticks.length).toBeGreaterThanOrEqual(5);
        expect(result.ticks.length).toBeLessThanOrEqual(9);
        const coarse = result.ticks.filter((t) => t % result.coarseStep === 0);
        expect(coarse.length).toBeGreaterThanOrEqual(2);
      });
    });
  }
});
