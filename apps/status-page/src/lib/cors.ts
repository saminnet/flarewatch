import { pageConfig } from '@flarewatch/config';

export function getCorsHeaders(
  request: Request,
  allowedOrigins: string[] | undefined = pageConfig.apiCorsOrigins,
): Record<string, string> {
  const origin = request.headers.get('Origin');

  const base: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (!allowedOrigins || allowedOrigins.length === 0) {
    return { ...base, 'Access-Control-Allow-Origin': '*' };
  }

  if (origin && allowedOrigins.includes(origin)) {
    return { ...base, 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
  }

  return base;
}
