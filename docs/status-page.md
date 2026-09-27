# Status page

The status page is a Worker that reads what the monitor Worker saves. Visitors see public monitors, their uptime and response times, and the incident and maintenance history.

## Sign in

Set the `FLAREWATCH_ADMIN_BASIC_AUTH` secret ([how](deploy.md#3-add-secrets-to-your-fork)) and sign in at `/login`. The footer links to it. Once you're signed in, the same pages show everything:

- private monitors, with a Private badge
- the ping URL of each heartbeat
- buttons to add, edit and delete maintenance windows on History

The account menu has a **Visitor view** switch that shows the page the way visitors see it.

Without the secret, `/login` says sign-in isn't set up. In local development you are always signed in.

## Maintenance

Sign in and open History to plan a maintenance window: a title, a start, an optional end, and the monitors it covers. The dashboard shows active and upcoming windows, and covered monitors don't alert while a window is active.

Scripts can manage windows through `/api/admin/maintenances` (`GET`, `POST`, `PUT`, `DELETE`) with the same username and password in a Basic `Authorization` header.

## Private page

To keep the whole page to yourself, set `visibility: 'private'` in `packages/config/src/public.ts`. Visitors then get only the sign-in page. The dashboard, History, monitor pages, embeds, badges and the JSON API are closed to them. Heartbeat pings keep working.

This replaces the `FLAREWATCH_STATUS_PAGE_BASIC_AUTH` secret from 1.x. While that secret is still set, the page stays private. Once you've set `visibility`, delete it:

```bash
vp exec --filter status-page -- wrangler secret delete FLAREWATCH_STATUS_PAGE_BASIC_AUTH
```

## Page settings

`packages/config/src/public.ts`:

| Setting           | Does                                                           |
| ----------------- | -------------------------------------------------------------- |
| `title`           | Page and tab title.                                            |
| `logo`, `favicon` | Image URLs.                                                    |
| `links`           | Footer links, like `{ label: 'GitHub', link: 'https://...' }`. |
| `group`           | Monitor groups, like `{ APIs: ['api', 'auth'] }`.              |
| `visibility`      | `'private'` for a [private page](#private-page).               |
| `apiCorsOrigins`  | Origins allowed to call the JSON API. Defaults to any.         |
| `themeVars`       | Colour overrides. See [Theming](theming.md).                   |

## API, badges and embeds

| URL                       | Returns                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------- |
| `/api/data`               | Current status of every public monitor, as JSON.                                   |
| `/api/maintenances`       | Maintenance windows, as JSON.                                                      |
| `/api/badge?id=<monitor>` | An SVG badge. `label`, `up`, `down`, `colorUp` and `colorDown` change it.          |
| `/embed/<monitor>`        | A small status card for an iframe. Add `theme=light` or `dark`, or `minimal=true`. |
