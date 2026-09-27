# Theming

The page's colours are CSS custom properties. Override them with `themeVars` in `packages/config/src/public.ts`, and anything you don't set keeps its default. The defaults are in [`apps/status-page/src/styles.css`](../apps/status-page/src/styles.css).

```ts
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

`:root` sets light mode and `.dark` sets dark mode. The page puts the `.dark` class on `<html>`.

## Tokens

These are supported and stay stable across upgrades.

| Token                                    | Colours                              |
| ---------------------------------------- | ------------------------------------ |
| `--background` / `--foreground`          | The page and its text                |
| `--card` / `--card-foreground`           | Cards, dialogs, embeds               |
| `--popover` / `--popover-foreground`     | Tooltips, menus, the chart tooltip   |
| `--primary` / `--primary-foreground`     | Main buttons and accents             |
| `--secondary` / `--secondary-foreground` | Secondary surfaces                   |
| `--muted` / `--muted-foreground`         | Quiet backgrounds and secondary text |
| `--accent` / `--accent-foreground`       | Hover and active surfaces            |
| `--destructive`                          | Errors and delete buttons            |
| `--border`, `--input`, `--ring`          | Borders, form fields, focus rings    |
| `--radius`                               | Corner radius                        |
| `--chart-1` to `--chart-5`               | Chart lines                          |
| `--sidebar*`                             | Sidebar surfaces                     |

Each status has a solid colour for icons and text, a background, and a border:

| Status      | Solid                  | Background                | Border                        |
| ----------- | ---------------------- | ------------------------- | ----------------------------- |
| Operational | `--status-operational` | `--status-operational-bg` | `--status-operational-border` |
| Degraded    | `--status-degraded`    | `--status-degraded-bg`    | `--status-degraded-border`    |
| Down        | `--status-down`        | `--status-down-bg`        | `--status-down-border`        |
| Maintenance | `--status-maintenance` | `--status-maintenance-bg` | `--status-maintenance-border` |
| No data     | `--status-unknown`     | `--status-unknown-bg`     | `--status-unknown-border`     |

A maintenance window with its own severity colour uses that colour instead of the maintenance tokens.

## What isn't supported

Stick to colour and length values like `oklch(...)`, `#rrggbb` or `1rem`. New selectors, Tailwind classes, layout rules, fonts (`@import`, `@font-face`) and `url()` may render today but can break on any upgrade.

If `themeVars` contains `</style`, `<script` or `javascript:`, the page drops all of it and uses the defaults. That check lives in `sanitizeThemeVars()` in [`theme.ts`](../packages/shared/src/theme.ts), next to the list of supported tokens.
