import { pageConfig } from '@flarewatch/config';

export type CorsHeaders = {
  'Access-Control-Allow-Methods': string;
  'Access-Control-Allow-Headers': string;
  'Access-Control-Allow-Origin'?: string;
  Vary?: string;
} & Record<string, string>;

export function getCorsHeaders(
  request: Request,
  allowedOrigins: string[] | undefined = pageConfig.apiCorsOrigins,
): CorsHeaders {
  const origin = request.headers.get('Origin');

  const base = {
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
