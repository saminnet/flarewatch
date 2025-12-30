import { describe, it, expect } from 'vitest';
import { getStatusColor, getStatusHexColor, getStatusLabel } from '../../src/lib/color';

describe('color utilities', () => {
  it('maps uptime thresholds to tailwind classes', () => {
    expect(getStatusColor(99.9)).toEqual({
      bg: 'bg-emerald-500',
      text: 'text-emerald-500',
      border: 'border-emerald-500',
    });

    expect(getStatusColor(99)).toEqual({
      bg: 'bg-emerald-400',
      text: 'text-emerald-400',
      border: 'border-emerald-400',
    });

    expect(getStatusColor(95)).toEqual({
      bg: 'bg-amber-500',
      text: 'text-amber-500',
      border: 'border-amber-500',
    });

    expect(getStatusColor('not-a-number')).toEqual({
      bg: 'bg-neutral-400',
      text: 'text-neutral-400',
      border: 'border-neutral-400',
    });

    expect(getStatusColor(0)).toEqual({
      bg: 'bg-red-500',
      text: 'text-red-500',
      border: 'border-red-500',
    });
  });

  it('maps uptime thresholds to hex colors', () => {
    expect(getStatusHexColor(99.9)).toBe('#10b981');
    expect(getStatusHexColor(99.9, true)).toBe('#059669');
    expect(getStatusHexColor(99)).toBe('#34d399');
    expect(getStatusHexColor(95)).toBe('#f59e0b');
    expect(getStatusHexColor('not-a-number')).toBe('#a3a3a3');
    expect(getStatusHexColor(0)).toBe('#ef4444');
  });

  it('maps uptime thresholds to labels', () => {
    expect(getStatusLabel(99.9)).toBe('Operational');
    expect(getStatusLabel(99)).toBe('Good');
    expect(getStatusLabel(95)).toBe('Degraded');
    expect(getStatusLabel('not-a-number')).toBe('Unknown');
    expect(getStatusLabel(0)).toBe('Down');
  });
});
