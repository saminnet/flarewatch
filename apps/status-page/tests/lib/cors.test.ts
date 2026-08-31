import { describe, expect, it } from 'vite-plus/test';
import { getCorsHeaders } from '../../src/lib/cors';

const baseHeaders = {
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

describe('getCorsHeaders', () => {
  it('allows every origin when no allowlist is configured', () => {
    const request = new Request('https://status.example.com/api/data');

    expect(getCorsHeaders(request, [])).toEqual({
      ...baseHeaders,
      'Access-Control-Allow-Origin': '*',
    });
  });

  it('echoes an allowlisted origin and varies the response by Origin', () => {
    const request = new Request('https://status.example.com/api/data', {
      headers: { Origin: 'https://dashboard.example.com' },
    });

    expect(
      getCorsHeaders(request, ['https://dashboard.example.com', 'https://admin.example.com']),
    ).toEqual({
      ...baseHeaders,
      'Access-Control-Allow-Origin': 'https://dashboard.example.com',
      Vary: 'Origin',
    });
  });

  it('omits origin-specific headers for an origin outside the allowlist', () => {
    const request = new Request('https://status.example.com/api/data', {
      headers: { Origin: 'https://untrusted.example.com' },
    });

    expect(getCorsHeaders(request, ['https://dashboard.example.com'])).toEqual(baseHeaders);
  });
});
