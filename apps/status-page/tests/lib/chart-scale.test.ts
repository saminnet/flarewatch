import { describe, expect, it } from 'vite-plus/test';
import { linearScale, niceLinearTicks } from '@/lib/chart-scale';

const GOLDEN: Record<number, { ticks: number[]; max: number }> = {
  0: { ticks: [0], max: 0 },
  1: { ticks: [0, 0.2, 0.4, 0.6, 0.8, 1], max: 1 },
  5: { ticks: [0, 1, 2, 3, 4, 5], max: 5 },
  18: { ticks: [0, 5, 10, 15], max: 18 },
  37: { ticks: [0, 10, 20, 30, 40], max: 40 },
  46: { ticks: [0, 10, 20, 30, 40, 50], max: 50 },
  74: { ticks: [0, 20, 40, 60, 80], max: 80 },
  99: { ticks: [0, 20, 40, 60, 80, 100], max: 100 },
  118: { ticks: [0, 20, 40, 60, 80, 100, 120], max: 120 },
  200: { ticks: [0, 50, 100, 150, 200], max: 200 },
  242: { ticks: [0, 50, 100, 150, 200, 250], max: 260 },
  500: { ticks: [0, 100, 200, 300, 400, 500], max: 500 },
  750: { ticks: [0, 200, 400, 600, 800], max: 800 },
  999: { ticks: [0, 200, 400, 600, 800, 1000], max: 1000 },
  1000: { ticks: [0, 200, 400, 600, 800, 1000], max: 1000 },
  1500: { ticks: [0, 500, 1000, 1500], max: 1600 },
  3200: { ticks: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500], max: 3500 },
  9999: { ticks: [0, 2000, 4000, 6000, 8000, 10000], max: 10000 },
  10000: { ticks: [0, 2000, 4000, 6000, 8000, 10000], max: 10000 },
  12345: { ticks: [0, 2000, 4000, 6000, 8000, 10000, 12000], max: 13000 },
  54321: { ticks: [0, 10000, 20000, 30000, 40000, 50000], max: 55000 },
};

describe('niceLinearTicks', () => {
  for (const [max, expected] of Object.entries(GOLDEN)) {
    it(`matches d3 for maxPing=${max}`, () => {
      expect(niceLinearTicks(Number(max))).toEqual(expected);
    });
  }
});

describe('linearScale', () => {
  it('maps domain endpoints onto range endpoints', () => {
    const s = linearScale([0, 100], [40, 540]);
    expect(s(0)).toBe(40);
    expect(s(100)).toBe(540);
    expect(s(50)).toBe(290);
  });

  it('inverts pixel back to domain', () => {
    const s = linearScale([0, 250], [130, 5]);
    expect(s.invert(s(123))).toBeCloseTo(123, 9);
    expect(s.invert(130)).toBeCloseTo(0, 9);
    expect(s.invert(5)).toBeCloseTo(250, 9);
  });

  it('does not divide by zero on a degenerate domain', () => {
    const s = linearScale([42, 42], [0, 100]);
    expect(Number.isFinite(s(42))).toBe(true);
  });
});
