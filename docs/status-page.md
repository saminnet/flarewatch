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

Password attempts, provider sign-ins, check-now presses and scripted admin calls share a limit of 5 a minute per IP. Cloudflare counts it in each of its locations, and only roughly, so it slows down guessing but is not an exact cap. A session lasts 14 days. Signing out ends it at once where you are, but Cloudflare can take a minute or more to pass that on to its other locations.

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

## Incident acknowledgement

Operators can choose **Acknowledge** on an open incident, in History or in the History section of the monitor's page. Acknowledgement stops further reminders. It leaves the monitor's status and uptime unchanged. The monitor card then shows who acknowledged the incident and how long ago, for example "Acknowledged 12m ago by Pat". Visitors see "Acknowledged 12m ago", without the responder's name. An ended incident in History shows how long it waited, for example "Acknowledged after 2m 5s by Pat". The recovery alert names the signed-in provider's name, or `operator` for a password sign-in.

Scripts can send `POST {"id":"<monitor>"}` to `/api/admin/ack` with the same authentication as the other admin endpoints. It returns 204 for the first acknowledgement, or 409 when the monitor has no unacknowledged open incident. A second call changes nothing.

## Announcements

Sign in and open History, then choose **Add announcement** beside **Add maintenance window**. Give it a title and body, and optionally an end time in UTC. Active announcements appear on the dashboard under the status banner, newest first. You edit and delete them on History, as you do maintenance windows. Titles and bodies show exactly as typed. HTML tags and Markdown appear as text, so `<b>` shows as `<b>` and doesn't make text bold.

The hub keeps at most 50 announcements. A title needs text and can be at most 200 characters. A body needs text and can be at most 2000 characters. Ended announcements remain in the hub and feed until you delete them. History lists announcements and their updates for everyone who can see them. Operators can edit or delete ended announcements too.

Choose **Incident** in the form for a manual incident. Select its status and affected monitors, or leave the selection empty for the whole page. The statuses are `investigating`, `identified`, `monitoring` and `resolved`. A manual incident communicates what is happening. It does not change monitor status, recorded downtime or uptime.

To post progress, edit the incident and choose **Add update**. Set the status and write the update, then save. Each incident keeps up to 20 updates, oldest first, with at most 2000 characters per update. The server records the time and the signed-in provider's name, or `operator` for password sign-ins. The dashboard shows the current status and latest update. History shows every update, and the Atom feed gives each update its own entry. Visitors never receive private monitor IDs. An incident scoped only to private monitors stays private.

Scripts use `/api/admin/announcements` with the [same authentication as maintenance](#admin-endpoints):

| Method   | Body                                                                        | Result                                                                                               |
| -------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `GET`    | None                                                                        | All announcements, newest first.                                                                     |
| `POST`   | `{"title":"Update","body":"Work is complete","end":"2026-12-01T12:00:00Z"}` | The saved announcement, with its `id` and timestamps, and status 201. Omit `end` to keep showing it. |
| `PUT`    | `{"id":"ann_...","updates":{"body":"New details","end":null}}`              | The saved announcement. Omitted fields stay unchanged. `end: null` clears the end time.              |
| `DELETE` | `{"id":"ann_..."}`                                                          | Status 204, or 404 for an unknown id.                                                                |

A row without `kind` is a notice. To create a manual incident, send `kind: "incident"`, an optional `monitors` array of configured IDs, and `status`. An edit can keep a monitor ID that the config no longer contains. The form shows that ID as a chip you can remove. New IDs must exist in the config.

To append an update, send `PUT {"id":"ann_...","updates":{"addUpdate":{"status":"identified","body":"We found the cause."}}}` to `/api/admin/announcements`. The status page forwards only the update and responder to the internal `POST /announcements/<id>/updates` endpoint. The hub records the time and appends the update atomically. Existing updates stay unchanged, including during text edits. An unknown announcement gets 404, an invalid update gets 400, and an append past 20 updates gets 409.

Admin requests and internal record saves have a 64 KiB request limit. The internal append endpoint accepts up to 16 KiB per update request, independent of the accumulated history. The hub also checks the stored row against its 1.9 MB budget.

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

Every page sends a Content-Security-Policy header. It lets a page run scripts only from its own origin, plus the page's own inline scripts, which carry a new random nonce on each request. When Turnstile is enabled, scripts, frames and connections can also use `https://challenges.cloudflare.com`. Other injected scripts do not run. Images may load from any `https:` address or a `data:` URL, so a logo or favicon URL in your config still works. In the Vite dev server, pages also allow inline scripts and `eval`, for hot reload.

### Admin endpoints

These need the operator's sign-in: the session cookie, or the password sign-in's username and password in a Basic `Authorization` header. Each Basic call counts against the sign-in limit of 5 per minute per IP, and so does every check-now call, signed in or not. Answers are never cached. A call without the operator's sign-in gets 401. A call gets 403 when no sign-in is set up, or when a write comes from another origin. A call over the sign-in limit gets 429 with `Too many attempts`.

| URL                        | Does                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------- |
| `/api/admin/maintenances`  | Lists, adds, edits and deletes [maintenance windows](#maintenance).                                |
| `/api/admin/announcements` | Lists, adds, edits and deletes [announcements](#announcements).                                    |
| `/api/admin/ack`           | Acknowledges the open incident for `POST {"id":"<monitor>"}`.                                      |
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

## Email subscribers

Visitors can subscribe to incident emails for all published monitors from the Get updates button in the page header. They receive a confirmation email first, then an email when a monitor's incident opens or recovers. A manual incident and its updates appear on the page and in the feed, but send no email. Grace periods, maintenance windows, dependencies and flap holds follow the webhook alert rules. Private monitors and raw failure messages stay out of these emails. Operators see the confirmed subscriber count in their account menu.

To set it up:

1. Verify a sending domain in [Resend](https://resend.com/docs/dashboard/domains/introduction).
2. Add `RESEND_API_KEY` and `SUBSCRIBER_SECRET` as GitHub secrets ([how](deploy.md#3-add-secrets-to-your-fork)). Use a random secret of at least 32 characters, such as the output of `openssl rand -base64 32`.
3. Set `PUBLIC_ORIGIN` in `services/worker/wrangler.toml` to your status page's HTTPS origin, such as `https://status.example.com`. Email links use this origin because an alarm has no visitor request.
4. Add `subscribers` to `pageConfig` in `packages/config/src/public.ts`:

```ts
subscribers: {
  from: 'Status <status@example.com>',
  dailySendCap: 90,
  maxSubscribers: 45,
},
```

Resend is the default provider. The sender must belong to your verified Resend domain. Both caps are optional and default to the values above. `maxSubscribers` defaults to half of `dailySendCap`, so one outage and its recovery reach the whole list within a day. Remove `subscribers` to turn the feature off. Private-only status pages do not offer subscriptions.

The subscriber cap counts pending and confirmed addresses together. Pending subscriptions and their confirmation links expire after 24 hours. Every signup answers “Check your inbox,” including an existing address or a full list. It does not reveal membership.

Mail leaves from the hub's alarm, outside the check run. Incident emails go first. Confirmation emails share the daily cap, but they stop at half of it, so a burst of signups can't use up the mail kept for incidents. The counter resets at midnight UTC. A full cap delays the remaining mail until the next day, so a list larger than half the cap receives updates late. Resend's Free plan currently allows 100 emails a day and 3,000 a month. Keep the default cap below those limits and leave room for other mail sent by your Resend account.

A batch reserves quota before sending. A failed or interrupted request keeps that reservation because Resend may already have accepted it. Retries reuse the saved body and idempotency key. The alarm stops retrying an ambiguous batch after 23 hours, before Resend's 24-hour key expires, and logs `Expired ambiguous subscriber batch`. That batch can lose mail rather than send duplicates. An unsubscribe takes effect before the next batch is prepared. A batch already submitted to Resend cannot be recalled.

Each email includes an unsubscribe link and RFC 8058 one-click unsubscribe headers. Opening the link shows a button. A mail client's one-click POST unsubscribes directly, as a URL-encoded or multipart form. The link in a confirmation email also opens a button, so a mail scanner that follows it can't confirm an address. Each unsubscribe link has its own rate limit, because mail providers post from shared addresses. The monitor Worker checks HMAC tokens without a token table. Rotating `SUBSCRIBER_SECRET` invalidates outstanding confirmation and unsubscribe links.

Resend reports delivery bounces asynchronously. This version does not consume bounce webhooks or remove those addresses from the local list. Resend manages its own suppression list. Check bounces and suppressions in Resend before raising the subscriber cap.

### Cloudflare Email Service

Set `provider: 'cloudflare'` in `subscribers` to send through Cloudflare instead of Resend. Omit `provider` or set `provider: 'resend'` for Resend.

Cloudflare requires the Workers Paid plan for arbitrary subscriber addresses. Outbound mail to arbitrary recipients is unavailable on Free. Paid includes 3,000 emails per month, then costs $0.35 per 1,000. Onboard the sending domain to [Email Service](https://developers.cloudflare.com/email-service/get-started/send-emails/) before enabling this provider. See [pricing](https://developers.cloudflare.com/email-service/platform/pricing/).

Add this block to `services/worker/wrangler.toml`, the monitor Worker's config:

```toml
[[send_email]]
name = "SUBSCRIBER_EMAIL"
```

The equivalent JSON configuration is `"send_email": [{ "name": "SUBSCRIBER_EMAIL" }]`. The committed config leaves the binding out so the default deployment stays on Free. Keep `SUBSCRIBER_SECRET` and `PUBLIC_ORIGIN` as above. Cloudflare needs no `RESEND_API_KEY`. Use a plain verified address for `from`, such as `status@example.com`.

The [Workers API](https://developers.cloudflare.com/email-service/api/send-emails/workers-api/) accepts plain objects with `from`, `to`, `subject`, `text`, `html` and `headers`. It does not require the legacy `EmailMessage` from `cloudflare:email`. Each call allows up to 50 addresses across `to`, `cc` and `bcc`, with a 5 MiB message limit. Custom headers have a 16 KB total limit and a 2,048-byte limit per value. FlareWatch sends one message per recipient to keep addresses private.

Cloudflare has no batch endpoint or idempotency key. The alarm prepares up to ten recipients at a time and saves a sent index after each successful call. A retry resumes after that index, including after 24 hours. A crash between a send and its progress write can double-send one message. Both providers reserve quota before sending and keep the daily cap and retry backoff. A retry on a new UTC day reserves quota only for Cloudflare's remaining recipients.

Errors are `Error` objects with a `code`. FlareWatch retries `E_RATE_LIMIT_EXCEEDED` with backoff. It logs `E_SENDER_NOT_VERIFIED` and `E_SENDER_DOMAIN_NOT_AVAILABLE` as permanent failures and drops the affected outbox event. Fix the domain setup before accepting more subscriptions. These failures can lose queued mail. Cloudflare bounces and suppressions do not remove addresses from FlareWatch's list.

### Optional Turnstile

Create a Turnstile widget for the status page hostname. Add its secret as the GitHub secret `TURNSTILE_SECRET`, and add its public site key to `apps/status-page/wrangler.jsonc`:

```jsonc
"vars": { "TURNSTILE_SITE_KEY": "your-public-site-key" },
```

When `TURNSTILE_SECRET` is set, signup requires a valid token for that hostname. Without it, the form needs no challenge. The separate `SUBSCRIBE_RATE_LIMIT` binding always limits subscribe, confirm and unsubscribe requests to roughly five per minute per IP and Cloudflare location.
