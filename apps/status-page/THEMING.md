# Theming the status page

The status page is themed with CSS custom properties (design tokens). The defaults live in
[`src/styles.css`](src/styles.css) under `:root` (light) and `.dark` (dark). You can override any of
the supported tokens without forking the UI.

Set the tokens documented below; those are supported and stay stable across upgrades. The runtime
only applies a safety floor (see below), not token-only parsing, so other CSS that gets past the
floor may still render in the browser. It isn't part of the contract and can break on any upgrade, so
don't depend on extra selectors, classes, imports, `url()`, or layout rules.

## How to override tokens

Set `statusPage.themeVars` in your page config (`packages/config/src/public.ts`) to a string of CSS.
It is injected into an inline `<style>` in the document `<head>`, so it cascades over the defaults.

```ts
// packages/config/src/public.ts
export const pageConfig: PageConfig = {
  title: 'Acme Status',
  themeVars: `
    :root {
      --primary: oklch(0.62 0.19 259);
      --status-operational: oklch(0.70 0.17 162);
    }
    .dark {
      --primary: oklch(0.71 0.16 255);
    }
  `,
};
```

Selectors that match how the page sets its own values:

- `:root`: light-mode values
- `.dark`: dark-mode values (the page toggles the `.dark` class on `<html>`)

Tokens you don't set keep their defaults. Tokens that aren't in the supported list have no runtime
effect; they're just inert custom properties.

## Safety floor

Injected `themeVars` passes through `sanitizeThemeVars()` (see
[`packages/shared/src/runtime-contract.ts`](../../packages/shared/src/runtime-contract.ts)) before
it reaches the page. The floor guarantees the string cannot break out of the inline `<style>`: if it
contains `</style`, `<script`, or `javascript:` (case-insensitive), the whole `themeVars` value is
dropped and the page falls back to the built-in defaults.

The floor is a security boundary, not a linter. It does not validate token names or values; it only
blocks style-context breakout. Keep values to plain CSS color/length syntax (e.g. `oklch(...)`,
`#rrggbb`, `1rem`). Avoid `url()`, `@import`, and any markup.

## Supported tokens

### Base UI

| Token                                    | Purpose                               |
| ---------------------------------------- | ------------------------------------- |
| `--background` / `--foreground`          | Page background and default text      |
| `--card` / `--card-foreground`           | Cards, dialogs, embed surface         |
| `--popover` / `--popover-foreground`     | Tooltips, dropdowns, chart tooltip    |
| `--primary` / `--primary-foreground`     | Primary actions and accents           |
| `--secondary` / `--secondary-foreground` | Secondary surfaces                    |
| `--muted` / `--muted-foreground`         | Subtle backgrounds and secondary text |
| `--accent` / `--accent-foreground`       | Hover/active surfaces                 |
| `--destructive`                          | Error text and destructive actions    |
| `--border`                               | Borders and dividers                  |
| `--input`                                | Form control borders                  |
| `--ring`                                 | Focus rings                           |
| `--radius`                               | Corner radius scale                   |
| `--chart-1` … `--chart-5`                | Chart series colors                   |
| `--sidebar*`                             | Sidebar surface tokens                |

### Status states

Each status state has three tokens: the solid/icon/text color, a subtle surface background, and a
border for that surface.

| State             | Solid / icon / text    | Surface background        | Surface border                |
| ----------------- | ---------------------- | ------------------------- | ----------------------------- |
| Operational       | `--status-operational` | `--status-operational-bg` | `--status-operational-border` |
| Degraded          | `--status-degraded`    | `--status-degraded-bg`    | `--status-degraded-border`    |
| Down              | `--status-down`        | `--status-down-bg`        | `--status-down-border`        |
| Maintenance       | `--status-maintenance` | `--status-maintenance-bg` | `--status-maintenance-border` |
| Unknown / no data | `--status-unknown`     | `--status-unknown-bg`     | `--status-unknown-border`     |

Where they show up:

- Operational: the overall "all operational" banner, monitor up icons, healthy uptime bars and
  cells, and the "no events" state.
- Degraded: the overall "some down" banner, partial uptime, and the stale-data and maintenance "ends
  in" warnings.
- Down: the overall "all down" banner, down icons, incident cards, and monitor error text.
- Maintenance: the upcoming-maintenance indicator, plus the default maintenance card and banner
  (background, border, icon) when a maintenance has no authored severity color. A maintenance with an
  authored severity color uses that palette instead.
- Unknown: no-data uptime cells and bar segments.

The supported list lives in
[`runtime-contract.ts`](../../packages/shared/src/runtime-contract.ts) (`SUPPORTED_THEME_TOKENS`),
and the docs and tests read from it. [`tests/theme-tokens.test.ts`](tests/theme-tokens.test.ts)
checks that every status token is defined in the default CSS and registered as a Tailwind alias, and
[`packages/shared/tests/runtime-contract.test.ts`](../../packages/shared/tests/runtime-contract.test.ts)
checks that unsafe `themeVars` are rejected.

## Example: full light + dark override

```css
:root {
  --background: oklch(0.99 0 0);
  --foreground: oklch(0.15 0 0);
  --primary: oklch(0.62 0.19 259);
  --status-operational: oklch(0.7 0.17 162);
  --status-down: oklch(0.64 0.24 25);
}

.dark {
  --background: oklch(0.15 0 0);
  --foreground: oklch(0.98 0 0);
  --primary: oklch(0.71 0.16 255);
}
```

## Outside the supported contract

The safety floor is the only check, so the browser may still render some of these if they slip
through. None of it is part of the theme contract, and it can break on any upgrade, so don't depend
on:

- Tailwind classes or new selectors
- Layout changes, custom HTML, or fonts (`@import`, `@font-face`)
- `url()` and remote resources
- Any declaration that targets something other than a documented token

Inline markup and scripts are the one hard guarantee: `</style`, `<script`, and `javascript:` cause
the whole `themeVars` value to be dropped.
