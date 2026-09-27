# FlareWatch

FlareWatch checks websites and background jobs from Cloudflare Workers and shows the results on one status page. One person runs it. Everyone else only reads it.

## People

**Operator**:
The person who deploys FlareWatch and signs in to it. There is exactly one.
_Avoid_: Admin, user, owner

**Visitor**:
Anyone reading the status page without signing in.
_Avoid_: Public user, guest, customer

## Pages

**Status page**:
The site the status-page worker serves: the dashboard, History and monitor pages. Operators and visitors see the same routes; operators see more.
_Avoid_: Public page, frontend

**Signed-in mode**:
The status page as the operator sees it: all monitors, operator details on each card, and maintenance editing on History.
_Avoid_: Admin page, admin panel, dashboard mode

**Visitor view**:
A switch that shows a signed-in operator the status page exactly as a visitor sees it.
_Avoid_: Preview, public preview

**Private-only**:
A deployment where visitors get the sign-in page and nothing else. Set in config (`statusPage.visibility: 'private'`), not at runtime.
_Avoid_: Private mode, locked mode

## Monitors

**Monitor**:
One thing FlareWatch watches. It is either a check monitor or a heartbeat monitor.

**Check monitor**:
A monitor that the worker probes on a schedule over HTTP or TCP.
_Avoid_: Pull monitor, web monitor, endpoint

**Heartbeat monitor**:
A monitor for a scheduled job. The job reports in by pinging FlareWatch; silence past the grace period means down.
_Avoid_: Cron monitor, push monitor, job monitor

**Ping**:
One request a job sends to its heartbeat monitor's ping URL (start, success or fail).
_Avoid_: Check-in, beat

**Published monitor**:
A monitor visitors can see. Monitors are published unless marked private.
_Avoid_: Public monitor

**Private monitor**:
A monitor only the operator sees. It is still checked, and it never appears in visitor responses: pages, API, badges or embeds.
_Avoid_: Hidden monitor, internal monitor

## History

**History**:
The page that lists incidents and maintenance windows by month, at `/history`.
_Avoid_: Events page, timeline

**Maintenance window**:
A planned period, with start, end and affected monitors, that the operator adds on History. The only thing editable at runtime.
_Avoid_: Maintenance event, scheduled maintenance

**Incident**:
A stretch of downtime FlareWatch recorded for a monitor.
_Avoid_: Outage, event
