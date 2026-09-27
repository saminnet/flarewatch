# Status page

The status page is a Worker that reads what the monitor Worker saves. Visitors see public monitors, their uptime and response times, and the incident and maintenance history.

## Sign in

There are two ways to sign in at `/login`, and you can use both. The footer links to it.

- **A password**, for you alone: set the `FLAREWATCH_ADMIN_BASIC_AUTH` secret ([how](deploy.md#3-add-secrets-to-your-fork)).
- **A provider**, for you and anyone else you let in: [below](#sign-in-with-a-provider).

As the operator, the same pages show you everything:

- private monitors, with a Private badge
- the ping URL of each heartbeat
- buttons to add, edit and delete maintenance windows on History

The account menu has a **Visitor view** switch that shows the page the way visitors see it.

Without a password or a provider, `/login` says sign-in isn't set up. In local development you are always signed in.

## Sign in with a provider

Any OpenID Connect provider works: Pocket ID, Google, Authentik, Keycloak and others. So does GitHub. List them in `packages/config/src/access.ts`, along with who may sign in and what they see:

```ts
export const accessConfig: AccessConfig = {
  providers: [
    { id: 'pocket-id', name: 'Pocket ID', issuer: 'https://id.example.com', clientId: '...' },
    { id: 'github', name: 'GitHub', type: 'github', clientId: '...' },
  ],
  operators: ['you@example.com', 'group:flarewatch-admins'],
  members: ['*@example.com', 'github:teammate'],
  audiences: { acme: { members: ['*@acme.example'], groups: ['Acme'] } },
};
```

- **Operators** see and edit everything, like the password sign-in.
- **Members** see every monitor, private ones too, but can't change anything or copy ping URLs.
- **Audiences** see the public monitors plus the monitors in the page groups you list. That's how a client sees their own private monitors and nobody else's.

A rule is an email, a whole domain (`*@example.com`), a group from the provider (`group:admins`) or a GitHub login (`github:octocat`). An email only counts once the provider has verified it, and an email rule matches that address from any provider you list. So list only providers you trust to verify addresses. The rules are checked on every request, so removing someone from the list locks them out straight away. Anyone the rules don't cover is turned away at sign-in.

To set up a provider:

1. Create an OAuth or OpenID Connect client with the provider. The callback URL is `https://<your status page>/auth/callback`.
2. Add it to `access.ts` with the client ID.
3. Add two GitHub secrets ([how](deploy.md#3-add-secrets-to-your-fork)): `FLAREWATCH_AUTH_SECRET`, any long random string, and `FLAREWATCH_OIDC_SECRETS`, each client secret keyed by provider id, like `{"pocket-id": "...", "github": "..."}`. A Pocket ID client set up as public needs no client secret.

Pocket ID sends your groups when the client asks for them, so `group:` rules follow the groups you manage there.

## Maintenance

Sign in and open History to plan a maintenance window: a title, a start, an optional end, and the monitors it covers. The dashboard shows active and upcoming windows, and covered monitors don't alert while a window is active.

Scripts can manage windows through `/api/admin/maintenances` (`GET`, `POST`, `PUT`, `DELETE`) with the same username and password in a Basic `Authorization` header. Each such call counts against the sign-in limit of 5 per minute per IP, like password attempts and provider sign-ins.

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
