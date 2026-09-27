<p align="center">
  <img src="apps/status-page/public/favicon.svg" width="64" alt="" />
</p>

<h1 align="center">FlareWatch</h1>

<p align="center">
  A self-hosted uptime monitor and status page that runs free on Cloudflare Workers.<br />
  Fork it, edit one config file, and push. There's no server to look after.
</p>

<p align="center">
  <a href="https://demo.flarewatch.app">Live demo</a> ·
  <a href="docs/deploy.md">Deploy</a> ·
  <a href="#docs">Docs</a>
</p>

<p align="center">
  <img src="docs/assets/how-it-works.svg" alt="How FlareWatch works. Inside your Cloudflare account, a monitor Worker runs every minute. It checks your sites and APIs, saves the results to KV storage, and sends alerts when something goes down or comes back up. Your scheduled jobs ping the status page Worker when they finish. The status page Worker reads KV storage and serves the status page. Visitors see what you publish, and you sign in to see everything. Checks can also run from other regions or private networks through Globalping or your own proxy." />
</p>

## What you get

- Checks every minute for websites, APIs and TCP ports, and a warning before an SSL certificate expires.
- Heartbeats for backups, cron jobs and CI. They ping when they finish, and you hear about it when one doesn't.
- Alerts to Slack, Discord, Telegram, ntfy, email and [more](docs/alerts.md).
- A status page with uptime, response times and incident history.
- A sign-in for you, to see private monitors and plan maintenance. The whole page can be private too.
- Badges, embeds and a JSON API.

## Deploy

1. Fork this repo.
2. Add two repository secrets, `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN`. The [deploy guide](docs/deploy.md) lists the token permissions.
3. List your monitors in `packages/config/src/worker.ts`.
4. Push to `main`. GitHub Actions tests and deploys both Workers, then prints your status page URL.

A monitor is one line:

```ts
{ id: 'api', name: 'API', method: 'GET', target: 'https://example.com/health' }
```

## Cost

Nothing, for a personal or small-team page. FlareWatch uses two Workers, one KV namespace and one cron trigger, all within Cloudflare's free tier. The limit you're most likely to reach is 1,000 KV writes a day. The [deploy guide](docs/deploy.md#cost) says what uses them.

## Compared to others

- [Uptime Kuma](https://github.com/louislam/uptime-kuma) and [Gatus](https://github.com/TwiN/gatus) do more, but they need a server that's always on.
- [Upptime](https://github.com/upptime/upptime) needs no server either. It runs on GitHub Actions, which schedule checks every 5 minutes at best.
- FlareWatch needs no server, checks every minute, and costs nothing on the free tier.

## Docs

- [Deploy](docs/deploy.md): API token, secrets, custom domain, cost, uninstall
- [Monitors](docs/monitors.md): websites, TCP ports, heartbeats, private monitors, proxies
- [Alerts](docs/alerts.md): every channel and its setup
- [Status page](docs/status-page.md): sign-in, maintenance, private pages, API, embeds
- [Theming](docs/theming.md): colours and corner radius
- [Development](DEVELOPMENT.md): working on FlareWatch itself

MIT licensed. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md).
