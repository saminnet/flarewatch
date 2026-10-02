import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';

/**
 * The stylesheet must define every status token in both light (:root) and dark (.dark),
 * and register a Tailwind color alias so `bg-/text-/border-status-*` utilities resolve.
 */
const css = readFileSync(fileURLToPath(new URL('../src/styles.css', import.meta.url)), 'utf8');

function block(selector: string): string {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`Could not find "${selector} { ... }" block in styles.css`);
  return match[1]!;
}

const rootBlock = block(':root');
const darkBlock = block('\\.dark');
const themeBlock = block('@theme inline');

const statusTokens = [
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
];

describe('default theme tokens', () => {
  it('defines every status token in :root and .dark', () => {
    for (const token of statusTokens) {
      expect(rootBlock, `:root missing --${token}`).toContain(`--${token}:`);
      expect(darkBlock, `.dark missing --${token}`).toContain(`--${token}:`);
    }
  });

  it('registers every status token as a Tailwind color alias', () => {
    for (const token of statusTokens) {
      expect(themeBlock, `@theme inline missing --color-${token}`).toContain(
        `--color-${token}: var(--${token})`,
      );
    }
  });
});
