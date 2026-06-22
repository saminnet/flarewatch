import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vite-plus/test';
import { SUPPORTED_THEME_TOKENS } from '@flarewatch/shared';

/**
 * The default stylesheet must define every status token from the runtime contract,
 * in both light (:root) and dark (.dark), and register a Tailwind color alias so
 * `bg-/text-/border-status-*` utilities resolve. This is the runtime side of the
 * theme contract self-hosters can hand-edit.
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

const statusTokens = SUPPORTED_THEME_TOKENS.filter((token) => token.startsWith('status-'));

describe('default theme tokens', () => {
  it('defines a non-empty set of status tokens to check', () => {
    expect(statusTokens.length).toBeGreaterThan(0);
  });

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

  it('defines every base contract token in :root', () => {
    for (const token of SUPPORTED_THEME_TOKENS) {
      expect(rootBlock, `:root missing --${token}`).toContain(`--${token}:`);
    }
  });
});
