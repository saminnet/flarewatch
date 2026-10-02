# Alerts

FlareWatch sends a message when a monitor goes down and again when it comes back up. Set the channels in `notification.webhook` in `packages/config/src/worker.ts`. Each entry needs a `url`. Give it a `template` and FlareWatch writes the message for you, or write the payload yourself as in [Anything else](#anything-else).

```ts
notification: {
  webhook: [
    { url: 'https://hooks.slack.com/services/...', template: 'slack' },
    {
      url: 'https://api.pushover.net/1/messages.json',
      template: 'pushover',
      options: { token: 'app-token', user: 'user-key' },
    },
  ],
},
```

Webhook URLs usually contain a secret, and a fork of a public repo is public too. To keep them out of git, put them in the `FLAREWATCH_WEBHOOKS` [GitHub secret](deploy.md#3-add-secrets-to-your-fork) instead, as JSON in the same shape:

```json
[{ "url": "https://hooks.slack.com/services/...", "template": "slack" }]
```

Each deploy copies the secret to the monitor Worker. It alerts these webhooks as well as the ones in `worker.ts`. Tokens in `headers` or `options` can go in the secret too. The Worker skips a broken entry and logs why. The others still alert. If an entry has a `timeout` out of range, the Worker uses the default timeout. The entry still alerts.

A monitor in an active [maintenance window](status-page.md#maintenance) sends no down alert. If it's still down when the window ends, it alerts then. An outage that alerted before the window still sends its recovery.

## Dependencies

Some monitors reach their target through something else, like a reverse proxy, a VPN or one server that runs several apps. When that goes down, every monitor behind it fails too. Put it in `dependsOn` and you get one alert, not one per monitor:

```ts
{ id: 'proxy', name: 'Reverse proxy', method: 'GET', target: 'https://proxy.example.com/health' },
{ id: 'app', name: 'App', method: 'GET', target: 'https://app.example.com', dependsOn: ['proxy'] },
{ id: 'wiki', name: 'Wiki', method: 'GET', target: 'https://wiki.example.com', dependsOn: ['proxy'] },
```

- While the proxy is down, App and Wiki don't alert. The proxy's alert ends with `Also down: App, Wiki`, naming the ones already down when it goes out. A long list ends with "and N more".
- A monitor with `dependsOn` waits one extra check, about a minute, before its first alert. So an app that fails a minute before its proxy is still covered.
- When the proxy is back, anything still down behind it alerts on its own.
- A monitor that already sent a down alert still sends its recovery, even while the proxy is down.
- The status page and History show every monitor as it is. Only alerts change.

Dependencies can have their own dependencies, and heartbeats can use `dependsOn` too. The config check rejects unknown ids and loops.

A monitor that fails again within 15 minutes of recovering reopens the same outage, so a flapping target doesn't fill History. It sends a new down alert once it has been down for the whole grace period again. A reopened outage ends only after the monitor has stayed up for 15 minutes. Its recovery alert goes out then, and the outage counts as ending when the monitor came back up.

If no webhook accepts a down alert, FlareWatch tries it again on each check run, up to 10 times. After that it stops alerting about that outage. Recovery alerts and error changes are sent once, without retries. An outage sends at most 5 error changes, and 5 more each time it reopens.

A recovery alert only follows a down alert that went out. If you remove every webhook while a monitor is down, its recovery goes unannounced.

## Channels

| Template                   | URL                                                                                                | Also needs                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `slack`                    | Incoming webhook URL                                                                               |                                                                          |
| `discord`                  | Webhook URL                                                                                        |                                                                          |
| `telegram`                 | `https://api.telegram.org/bot<token>/sendMessage?chat_id=<chat-id>`                                |                                                                          |
| `ntfy`                     | Topic URL, like `https://ntfy.sh/<long-random-topic>`                                              | An `Authorization` header on private servers                             |
| `teams`                    | Incoming webhook URL of a channel                                                                  |                                                                          |
| `googlechat`               | Incoming webhook URL of a space                                                                    |                                                                          |
| `matrix`                   | `https://<homeserver>/_matrix/client/v3/rooms/<room-id>/send/m.room.message/?access_token=<token>` |                                                                          |
| `pushover`                 | `https://api.pushover.net/1/messages.json`                                                         | `options.token`, `options.user`                                          |
| `gotify`                   | `https://<gotify-host>/message?token=<app-token>`                                                  |                                                                          |
| `zulip`                    | `https://<bot-email>:<bot-api-key>@<zulip-host>/api/v1/messages`                                   | `options.to`, `options.topic`                                            |
| `resend` (email)           | `https://api.resend.com/emails`                                                                    | `Authorization: Bearer <key>` in `headers`, `options.from`, `options.to` |
| `mattermost`, `rocketchat` | Incoming webhook URL                                                                               |                                                                          |
| `text`                     | Any URL that takes a plain text body                                                               |                                                                          |

## Anything else

Leave out `template` and write the payload yourself. `$MSG` is replaced with the message. This reaches Signal, WhatsApp or SMS through a gateway such as CallMeBot or Twilio.

```ts
{
  url: 'https://example.com/webhook',
  payloadType: 'json',
  payload: { text: '$MSG', channel: '#alerts' },
}
```

`payloadType` can also be `'param'` (query string) or `'x-www-form-urlencoded'`.

## Settings

| Setting                       | Does                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `gracePeriod`                 | Minutes a check monitor stays down before the alert goes out. Heartbeats use their own `graceSeconds`. |
| `timeZone`                    | Time zone for times in messages. Defaults to UTC.                                                      |
| `skipNotificationIds`         | Monitor IDs that never alert.                                                                          |
| `skipErrorChangeNotification` | Don't alert again when a down monitor's error changes.                                                 |
