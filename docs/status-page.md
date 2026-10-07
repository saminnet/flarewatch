# Status page

The status page is a Worker that reads what the monitor Worker saves. Visitors see public monitors, their uptime and response times, and the incident and maintenance history.

## Sign in

There are two ways to sign in at `/login`, and you can use both. The footer links to it.

- **A password**, for you alone: set the `FLAREWATCH_ADMIN_BASIC_AUTH` secret ([how](deploy.md#3-add-secrets-to-your-fork)).
- **A provider**, for you and anyone else you let in: [below](#sign-in-with-a-provider).

As the operator, the same pages show you everything:

- private monitors, with a Private badge
- the ping URL of each heartbeat
- a **Check now** button on each check monitor's page
- buttons to add, edit and delete maintenance windows on History
- an announcement form on History, and controls to edit or delete announcements

**Check now** runs that monitor's check once and shows the result under the button: up or down, the response time, where it ran from, and the error if it failed. It saves nothing. The page, History and alerts still show the last scheduled check run until the next one. Each press counts against the sign-in limit of 5 per minute per IP, because each one sends a real request to the target, directly or through Globalping or a proxy.

The account menu has a **Visitor view** switch that shows the page the way visitors see it.

Without a password or a provider, `/login` says sign-in isn't set up. On the dev server (`vp run dev-status-page`) with no sign-in set up, you are always signed in as the operator.

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

Sign in and open History to plan a maintenance window: a description, a start, and optionally a title, an end and the monitors it covers. The dashboard shows active and upcoming windows, and covered monitors send no down alerts while a window is active. History keeps incidents and ended windows for 90 days, and at most 1,000 past incidents, or about 1 MB of them, per monitor.

Scripts can manage windows through `/api/admin/maintenances` (`GET`, `POST`, `PUT`, `DELETE`) with the same username and password in a Basic `Authorization` header. Each such call counts against the sign-in limit of 5 per minute per IP, like password attempts and provider sign-ins.

### Repeating windows

A window can repeat every day, week or month. Its start and end set the first run and how long each run lasts, up to 24 hours. Every run starts at the same clock time as the first, in the window's time zone. In the form, pick a **Repeat** option. Its date pickers are in UTC, so pick the UTC time of the first run. Scripts send a `repeat` object.

A backup at 03:00 Berlin time every night, half an hour long:

```json
{
  "body": "Nightly backup",
  "start": "2026-10-05T01:00:00Z",
  "end": "2026-10-05T01:30:00Z",
  "repeat": { "every": "day", "timeZone": "Europe/Berlin" }
}
```

It runs at 01:00 UTC until the clocks go back on 25 October, then at 02:00 UTC. In Berlin it's 03:00 either way.

Patching on Tuesdays and Thursdays at 22:00 UTC, until the end of the year:

```json
{
  "body": "OS patches",
  "start": "2026-10-06T22:00:00Z",
  "end": "2026-10-06T23:00:00Z",
  "repeat": { "every": "week", "weekdays": [2, 4], "until": "2026-12-31T23:59:59Z" }
}
```

A database upgrade on the 31st of each month:

```json
{
  "body": "Database upgrade",
  "start": "2026-10-31T04:00:00Z",
  "end": "2026-10-31T06:00:00Z",
  "repeat": { "every": "month", "dayOfMonth": 31 }
}
```

Months with fewer than 31 days get no run, so this one skips November and runs again on 31 December.

| Field        | Does                                                                                                                        |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `every`      | `day`, `week` or `month`.                                                                                                   |
| `weekdays`   | Weekly only. Days from 0 (Sunday) to 6 (Saturday). Defaults to the start's weekday. A list you give needs at least one day. |
| `dayOfMonth` | Monthly only. 1 to 31. Defaults to the start's day. Months without that day are skipped.                                    |
| `until`      | No run starts after this. It can't be before `start`. Without it, the window repeats until you delete it.                   |
| `timeZone`   | The zone the clock time follows, like `Europe/Berlin` or `America/New_York`. Defaults to UTC.                               |

- The first run is on the start's day if the rule includes that day. If it doesn't, say a Monday start with `weekdays: [3]`, the first run is the next day the rule includes.
- When the clocks go forward and skip a run's start time, that run starts at the moment they jump. A 02:30 run starts at 03:00 that night. When the clocks go back and 02:30 comes twice, the run starts at the first one.
- The dashboard shows the current or next run. History lists each run in its month. Covered monitors send no down alerts during a run.
- History keeps a repeating window for 90 days after `until` plus the length of one run. One without `until` stays until you delete it.

## Announcements

Sign in and open History, then choose **Add announcement** beside **Add maintenance window**. Give it a title and body, and optionally an end time in UTC. Active announcements appear above the dashboard's status banner, newest first. Titles and bodies render as plain text, including HTML tags and Markdown syntax.

The hub keeps at most 50 announcements. A title needs text and can be at most 200 characters. A body needs text and can be at most 2000 characters. Ended announcements remain in the hub and feed until you delete them. History lists them for the operator, so you can edit or delete an ended announcement too.

Scripts use `/api/admin/announcements` with the [same authentication as maintenance](#admin-endpoints):

| Method   | Body                                                                        | Result                                                                                               |
| -------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET`    | None                                                                        | All announcements, newest first.                                                                     |
| `POST`   | `{"title":"Update","body":"Work is complete","end":"2026-12-01T12:00:00Z"}` | The saved announcement, with its `id` and timestamps, and status 201. Omit `end` to keep showing it. |
| `PUT`    | `{"id":"ann_...","updates":{"body":"New details","end":null}}`              | The saved announcement. Omitted fields stay unchanged. `end: null` clears the end time.              |
| `DELETE` | `{"id":"ann_..."}`                                                          | Status 204, or 404 for an unknown id.                                                                |

A wrong field type or a limit violation gets 400 with an error that names the field. At 50 announcements, you can still edit or delete existing records.

## Atom feed

Subscribe to `/feed.atom` in an Atom reader. The page head also advertises the feed for readers that discover subscriptions from a page URL.

The feed lists the newest 50 public incidents, maintenance windows and announcements, ordered by incident start, maintenance start or announcement creation time. Entries keep their IDs when you edit an announcement, reschedule maintenance or an incident recovers. Repeating maintenance has one entry per stored window. Ended announcements stay in the feed until deleted.

The feed uses the visitor snapshot, including the same 20-second hub cache as the page. Its `updated` value comes from the last check run, so an operator edit updates an entry before the feed timestamp advances. Private monitors and maintenance windows that cover only private monitors never appear. Text remains plain text. If the hub cannot answer, the feed has no entries and uses the Unix epoch as its update time.

## Private page

To keep the whole page to yourself, set `visibility: 'private'` in `packages/config/src/public.ts`. Visitors then get only the sign-in page. The dashboard, History, monitor pages, embeds, badges, Atom feed and the JSON API are closed to them. Heartbeat pings keep working.

## Page settings

`packages/config/src/public.ts`:

| Setting           | Does                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| `title`           | Page and tab title.                                                                                       |
| `logo`, `favicon` | Paths, `https:` URLs or `data:image/` URLs: PNG, JPEG, GIF, WebP or ICO. An `http:` URL fails the config. |
| `links`           | Footer links, like `{ label: 'GitHub', link: 'https://...' }`.                                            |
| `group`           | Monitor groups, like `{ APIs: ['api', 'auth'] }`.                                                         |
| `visibility`      | `'private'` for a [private page](#private-page).                                                          |
| `apiCorsOrigins`  | Origins allowed to call the JSON API. Defaults to any.                                                    |

Colours and the corner radius are CSS variables at the top of [`apps/status-page/src/styles.css`](../apps/status-page/src/styles.css), in a `:root` block for light mode and a `.dark` block for dark mode. Edit them there.

### Upstream demo

The upstream deployment uses `packages/config/src/demo/worker.ts` and `demo/public.ts`. It keeps the six original monitor IDs for their stored history, shows **FlareWatch demo**, and links to **Deploy your own**. The deploy workflow copies those files over the starter files only in `saminnet/flarewatch`. Forks continue to edit `packages/config/src/worker.ts` and `public.ts`.

## Statuses

Every monitor shows one status. Its row, the banner, the JSON API and embeds all agree. A badge shows pending and running as up, and unknown before the monitor's first result.

| Status     | Means                                                                     |
| ---------- | ------------------------------------------------------------------------- |
| `up`       | Working.                                                                  |
| `degraded` | A job is late, or a site's last check was slower than its `maxLatencyMs`. |
| `down`     | It has an open incident.                                                  |
| `pending`  | No result yet, or a job that hasn't pinged yet.                           |
| `running`  | A job has started and hasn't finished.                                    |

Only down counts against uptime.

## API, badges and embeds

| URL                           | Returns                                                                                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/data`                   | Current status of every public monitor, as JSON. Each has a `status` from [above](#statuses), and `up`, which is false only when `status` is `down`. |
| `/api/maintenances`           | Maintenance windows, as JSON.                                                                                                                        |
| `/api/badge?id=<monitor>`     | Badge data for shields.io: up, degraded or down. `label`, `up`, `degraded`, `down`, `colorUp`, `colorDegraded` and `colorDown` change it.            |
| `/api/badge.svg?id=<monitor>` | A flat SVG badge with the same parameters as the JSON badge.                                                                                         |
| `/feed.atom`                  | An Atom 1.0 feed of public incidents, maintenance windows and announcements.                                                                         |
| `/embed/<monitor>`            | A small status card for an iframe. Add `theme=light` or `dark`, or `minimal=true`.                                                                   |

Other sites can show `/embed` in a frame. All other pages refuse to load in a frame. This stops other sites from framing your sign-in page.

Every page sends a Content-Security-Policy header. It lets a page run scripts only from its own origin, plus the page's own inline scripts, which carry a new random nonce on each request. A script injected into the page from anywhere else doesn't run. Images may load from any `https:` address or a `data:` URL, so a logo or favicon URL in your config still works. In the Vite dev server, pages also allow inline scripts and `eval`, for hot reload.

### Admin endpoints

These need the operator's sign-in: the session cookie, or the password sign-in's username and password in a Basic `Authorization` header. Each Basic call counts against the sign-in limit of 5 per minute per IP, and so does every check-now call, signed in or not. Answers are never cached. A call without the operator's sign-in gets 401. A call gets 403 when no sign-in is set up, or when a write comes from another origin. A call over the sign-in limit gets 429 with `Too many attempts`.

| URL                        | Does                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `/api/admin/maintenances`  | Lists, adds, edits and deletes [maintenance windows](#maintenance).                                |
| `/api/admin/announcements` | Lists, adds, edits and deletes [announcements](#announcements).                                    |
| `/api/admin/check`         | `POST {"id": "<monitor>"}` runs that check monitor once and returns the result, without saving it. |

```bash
curl -fsS -u 'admin:your-password' -H 'Content-Type: application/json' \
  -d '{"id": "api"}' https://status.example.com/api/admin/check
```

```json
{ "location": "FRA", "result": { "ok": true, "latency": 87 } }
```

A failed check has `"ok": false` and an `error`. An unknown id gets a 404. A heartbeat id gets a 400, because a heartbeat has no check to run.

The JSON badge route works with [shields.io's endpoint badge](https://shields.io/badges/endpoint-badge). Pass it to shields.io, URL-encoded:

```md
![API status](https://img.shields.io/endpoint?url=https%3A%2F%2Fstatus.example.com%2Fapi%2Fbadge%3Fid%3Dapi)
```

For an image served by your own status page, use the SVG route:

```md
![API status](https://status.example.com/api/badge.svg?id=api&label=API)
```

The SVG badge caps the label and each message at 64 characters. It accepts shields.io named colors or three- and six-digit hex colors, with or without `#`. Other colors use the status default. Query text renders as text, including `<script>`. SVG responses use the JSON badge's cache headers, `nosniff`, and `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`.
