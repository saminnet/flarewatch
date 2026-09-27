import { describe, expect, it } from 'vite-plus/test';
import { openFlow, safeReturnTo, sealFlow, type SignInFlow } from '@/lib/auth/flow';

const NOW = 1_800_000_000;
const flow: SignInFlow = {
  provider: 'pocket-id',
  state: 'state-1',
  nonce: 'nonce-1',
  verifier: 'verifier-1',
  returnTo: '/history',
  expiresAt: NOW + 600,
};

describe('sign-in flow cookie', () => {
  it('opens what it sealed', async () => {
    await expect(openFlow('secret', await sealFlow('secret', flow), NOW)).resolves.toEqual(flow);
  });

  it('refuses another secret, an edited payload, an expired flow and junk', async () => {
    const sealed = await sealFlow('secret', flow);
    const [, signature] = sealed.split('.');
    const edited = `${(await sealFlow('secret', { ...flow, returnTo: '/admin' })).split('.')[0]}.${signature}`;

    await expect(openFlow('other', sealed, NOW)).resolves.toBeNull();
    await expect(openFlow('secret', edited, NOW)).resolves.toBeNull();
    await expect(openFlow('secret', sealed, NOW + 600)).resolves.toBeNull();
    await expect(openFlow('secret', 'not-a-cookie', NOW)).resolves.toBeNull();
  });
});

describe('safeReturnTo', () => {
  it('keeps paths on this site and sends everything else home', () => {
    expect(safeReturnTo('/monitors/api?view=visitor')).toBe('/monitors/api?view=visitor');
    for (const value of [
      null,
      '',
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/\r\n/evil.example',
    ]) {
      expect(safeReturnTo(value)).toBe('/');
    }
  });
});
