import { describe, it, expect } from 'vite-plus/test';
import { getStatusColor } from '@/lib/color';

describe('color utilities', () => {
  it('maps uptime thresholds to status token classes', () => {
    expect(getStatusColor(99.9)).toEqual({
      bg: 'bg-status-operational',
      text: 'text-status-operational',
      border: 'border-status-operational',
    });

    expect(getStatusColor(99.19)).toEqual({
      bg: 'bg-status-degraded',
      text: 'text-status-degraded',
      border: 'border-status-degraded',
    });

    expect(getStatusColor(99)).toEqual({
      bg: 'bg-status-degraded',
      text: 'text-status-degraded',
      border: 'border-status-degraded',
    });

    expect(getStatusColor(98.9)).toEqual({
      bg: 'bg-status-down',
      text: 'text-status-down',
      border: 'border-status-down',
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
});
