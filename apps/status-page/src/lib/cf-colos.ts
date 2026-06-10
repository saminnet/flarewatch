import { CF_COLO_MAP } from '@/lib/cf-colos-data';

const REGION_NAMES =
  typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['en'], { type: 'region' })
    : null;

export type CloudflareColoInfo = {
  code: string;
  city: string;
  countryCode: string;
};

function isIataCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

function lookupCloudflareColo(code: string): CloudflareColoInfo | null {
  const normalized = code.trim().toUpperCase();
  if (!isIataCode(normalized)) return null;

  const entry = CF_COLO_MAP[normalized];
  if (!entry) return null;
  return { code: normalized, city: entry.city, countryCode: entry.countryCode };
}

function countryNameFromCode(countryCode: string): string {
  const code = countryCode.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return countryCode;

  try {
    return REGION_NAMES?.of(code) ?? code;
  } catch {
    return code;
  }
}

export function formatColoLabel(code: string): string | null {
  const info = lookupCloudflareColo(code);
  if (!info) return null;
  return `${info.city}, ${countryNameFromCode(info.countryCode)}`;
}
