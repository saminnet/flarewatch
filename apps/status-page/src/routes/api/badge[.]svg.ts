import { createFileRoute } from '@tanstack/react-router';
import { readVisitorSnapshot } from '@/lib/snapshots';
import { projectBadgeStatus } from '@/lib/status-projection';
import { escapeXml } from '@/lib/xml';

const NAMED_COLORS = {
  brightgreen: '#4c1',
  green: '#97ca00',
  yellow: '#dfb317',
  yellowgreen: '#a4a61d',
  orange: '#fe7d37',
  red: '#e05d44',
  blue: '#007ec6',
  grey: '#555',
  gray: '#555',
  lightgrey: '#9f9f9f',
  lightgray: '#9f9f9f',
  blueviolet: '#8a2be2',
  pink: '#ff69b4',
  success: '#4c1',
  important: '#fe7d37',
  critical: '#e05d44',
  informational: '#007ec6',
  inactive: '#555',
} as const;

type NamedColor = keyof typeof NAMED_COLORS;

const GREY = NAMED_COLORS.lightgrey;

const HEX_COLOR = /^#?(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const MAX_TEXT = 64;

const CHAR_WIDTH_GROUPS: [number, string][] = [
  [3, "il.,;:|'!"],
  [4, 'fjt()[]{}I '],
  [5, 'r-/\\J'],
  [6, 'cksvxyz'],
  [8, 'ABDEFGHKLNOQRSTUVWXYZ'],
  [10, 'mM'],
  [11, 'W@%'],
];
const CHAR_WIDTHS = new Map<string, number>(
  CHAR_WIDTH_GROUPS.flatMap(([width, chars]) => Array.from(chars, (char) => [char, width])),
);
const DEFAULT_CHAR_WIDTH = 7;

function measure(text: string): number {
  let width = 0;
  for (const char of text) width += CHAR_WIDTHS.get(char) ?? DEFAULT_CHAR_WIDTH;
  return width;
}

const namedColors = new Map<string, string>(Object.entries(NAMED_COLORS));

function badgeColor(value: string | null, fallback: NamedColor): string {
  if (value !== null) {
    const lower = value.toLowerCase();
    const named = namedColors.get(lower);
    if (named) return named;
    if (HEX_COLOR.test(value)) return `#${lower.replace('#', '')}`;
  }
  return NAMED_COLORS[fallback];
}

const HEIGHT = 20;
const PADDING = 9;

function badgeSvg(label: string, message: string, color: string): string {
  const labelWidth = measure(label);
  const messageWidth = measure(message);
  const left = labelWidth + 2 * PADDING;
  const right = messageWidth + 2 * PADDING;
  const width = left + right;
  const title = `${escapeXml(label)}: ${escapeXml(message)}`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" role="img" aria-label="${title}">
  <title>${title}</title>
  <clipPath id="r"><rect width="${width}" height="${HEIGHT}" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${left}" height="${HEIGHT}" fill="#555"/>
    <rect x="${left}" width="${right}" height="${HEIGHT}" fill="${color}"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="110" text-rendering="geometricPrecision">
    <text x="${(left / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${labelWidth * 10}">${escapeXml(label)}</text>
    <text x="${(left / 2) * 10}" y="140" transform="scale(.1)" textLength="${labelWidth * 10}">${escapeXml(label)}</text>
    <text x="${(left + right / 2) * 10}" y="150" fill="#010101" fill-opacity=".3" transform="scale(.1)" textLength="${messageWidth * 10}">${escapeXml(message)}</text>
    <text x="${(left + right / 2) * 10}" y="140" transform="scale(.1)" textLength="${messageWidth * 10}">${escapeXml(message)}</text>
  </g>
</svg>`;
}

const svgHeaders = {
  'Content-Type': 'image/svg+xml',
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
  'Cache-Control': 'no-store, max-age=0, must-revalidate',
} as const;

/** Code points, not UTF-16 units, so a cut never splits a surrogate pair. */
function cap(text: string): string {
  return Array.from(text).slice(0, MAX_TEXT).join('');
}

function svgResponse(svg: string, status = 200): Response {
  return new Response(svg, { status, headers: svgHeaders });
}

export const Route = createFileRoute('/api/badge.svg')({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        try {
          const url = new URL(request.url);
          const { monitors, state, maintenances } = await readVisitorSnapshot();

          const defaultMonitorId = monitors[0]?.id;
          const monitorId = url.searchParams.get('id') ?? defaultMonitorId;
          const label = cap(url.searchParams.get('label') ?? monitorId ?? 'FlareWatch');

          const message = (text: string | null, fallback: string) => cap(text ?? fallback);
          const upMsg = message(url.searchParams.get('up'), 'UP');
          const downMsg = message(url.searchParams.get('down'), 'DOWN');
          const degradedMsg = message(url.searchParams.get('degraded'), 'DEGRADED');
          const colorUp = badgeColor(url.searchParams.get('colorUp'), 'brightgreen');
          const colorDown = badgeColor(url.searchParams.get('colorDown'), 'red');
          const colorDegraded = badgeColor(url.searchParams.get('colorDegraded'), 'yellow');

          if (!monitorId) {
            return svgResponse(badgeSvg(label, 'no-monitor', GREY), 400);
          }

          const monitor = monitors.find((candidate) => candidate.id === monitorId);
          if (!monitor) {
            return svgResponse(badgeSvg(label, 'unknown', GREY), 404);
          }

          if (!state) {
            return svgResponse(badgeSvg(label, 'unavailable', GREY), 503);
          }

          const projected = projectBadgeStatus(monitor, state, maintenances);
          if (projected.status === 'unknown') {
            return svgResponse(badgeSvg(label, 'unknown', GREY));
          }

          const looks: Record<typeof projected.status, [text: string, color: string]> = {
            up: [upMsg, colorUp],
            degraded: [degradedMsg, colorDegraded],
            down: [downMsg, colorDown],
          };
          const [text, color] = looks[projected.status];
          return svgResponse(badgeSvg(label, text, color));
        } catch (error) {
          console.error('Error rendering badge API:', error);
          return svgResponse(badgeSvg('status', 'error', GREY), 500);
        }
      },
    },
  },
});
