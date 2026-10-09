import { describe, it, expect } from 'vite-plus/test';
import { getStatusTone, uptimeTone } from '@/lib/color';

describe('color utilities', () => {
  it('maps uptime thresholds to a status tone', () => {
    expect(getStatusTone(99.9)).toBe('operational');
    expect(getStatusTone(99.19)).toBe('degraded');
    expect(getStatusTone(99)).toBe('degraded');
    expect(getStatusTone(98.9)).toBe('down');
    expect(getStatusTone(0)).toBe('down');
    expect(getStatusTone('not-a-number')).toBe('unknown');
    expect(getStatusTone(null)).toBe('unknown');
  });

  it('colors a heartbeat monitor by its state and any other monitor by its uptime', () => {
    expect(uptimeTone(true, 'down', 99.96)).toBe('down');
    expect(uptimeTone(true, 'degraded', 100)).toBe('degraded');
    expect(uptimeTone(true, 'running', 99.96)).toBe('operational');
    expect(uptimeTone(true, 'pending', null)).toBe('pending');
    expect(uptimeTone(false, 'down', 99.96)).toBe('operational');
    expect(uptimeTone(false, 'up', 98)).toBe('down');
  });
});
