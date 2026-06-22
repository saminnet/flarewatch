import { describe, it, expect } from 'vite-plus/test';
import { getStatusColor, getStatusHexColor } from '../../src/lib/color';

describe('color utilities', () => {
  it('maps uptime thresholds to status token classes', () => {
    expect(getStatusColor(99.9)).toEqual({
      bg: 'bg-status-operational',
      text: 'text-status-operational',
      border: 'border-status-operational',
    });

    expect(getStatusColor(99)).toEqual({
      bg: 'bg-status-operational',
      text: 'text-status-operational',
      border: 'border-status-operational',
    });

    expect(getStatusColor(95)).toEqual({
      bg: 'bg-status-degraded',
      text: 'text-status-degraded',
      border: 'border-status-degraded',
    });

    expect(getStatusColor('not-a-number')).toEqual({
      bg: 'bg-status-unknown',
      text: 'text-status-unknown',
      border: 'border-status-unknown',
    });

    expect(getStatusColor(null)).toEqual({
      bg: 'bg-status-unknown',
      text: 'text-status-unknown',
      border: 'border-status-unknown',
    });

    expect(getStatusColor(0)).toEqual({
      bg: 'bg-status-down',
      text: 'text-status-down',
      border: 'border-status-down',
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
});
