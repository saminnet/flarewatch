import { isNonEmptyString } from './utils';

/**
 * Themeable CSS custom properties (set as `--<token>`).
 * Base tokens mirror :root; status tokens color every up, down, degraded, maintenance and no-data state.
 */
export const SUPPORTED_THEME_TOKENS = [
  'accent',
  'accent-foreground',
  'background',
  'border',
  'card',
  'card-foreground',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'destructive',
  'foreground',
  'input',
  'muted',
  'muted-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'radius',
  'ring',
  'secondary',
  'secondary-foreground',
  'sidebar',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-ring',
  'status-degraded',
  'status-degraded-bg',
  'status-degraded-border',
  'status-degraded-text',
  'status-down',
  'status-down-bg',
  'status-down-border',
  'status-down-text',
  'status-maintenance',
  'status-maintenance-bg',
  'status-maintenance-border',
  'status-operational',
  'status-operational-bg',
  'status-operational-border',
  'status-unknown',
  'status-unknown-bg',
  'status-unknown-border',
] as const;

const THEME_TOKENS: ReadonlySet<string> = new Set(SUPPORTED_THEME_TOKENS);
const THEME_VALUE = /^[\w\s#%.,()/-]+$/;
const THEME_DECLARATION = /^\s*--([^:]*?)\s*:\s*(.*?)\s*$/s;

/** The declarations in `text` that set a supported token to a plain value, one per line. */
function themeDeclarations(text: string): string[] {
  return text.split(';').flatMap((declaration) => {
    const [, name = '', value = ''] = THEME_DECLARATION.exec(declaration) ?? [];
    const kept =
      THEME_TOKENS.has(name) &&
      value.length <= 200 &&
      THEME_VALUE.test(value) &&
      !/url\(/i.test(value);
    return kept ? [`  --${name}: ${value};`] : [];
  });
}

/**
 * themeVars rebuilt from what is safe in it: a `:root` and a `.dark` block of supported tokens set
 * to plain values, with declarations outside any block in `:root`. Everything else is dropped, so
 * nothing can leave the inline <style> or load a resource.
 */
export function sanitizeThemeVars(input: unknown): string {
  if (!isNonEmptyString(input)) return '';
  const blocks = new Map<string, string[]>([
    [':root', []],
    ['.dark', []],
  ]);
  for (const chunk of input.replace(/\/\*[\s\S]*?\*\//g, '').split('}')) {
    const open = chunk.indexOf('{');
    const outside = (open === -1 ? chunk : chunk.slice(0, open)).split(';');
    const selector = open === -1 ? undefined : outside.pop()?.trim();
    blocks.get(':root')?.push(...themeDeclarations(outside.join(';')));
    if (selector !== undefined) {
      blocks.get(selector)?.push(...themeDeclarations(chunk.slice(open + 1)));
    }
  }
  return [...blocks]
    .filter(([, lines]) => lines.length > 0)
    .map(([selector, lines]) => `${selector} {\n${lines.join('\n')}\n}`)
    .join('\n');
}
