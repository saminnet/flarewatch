# Alerts

FlareWatch sends a message when a monitor goes down and again when it comes back up. Set the channels in `notification.webhook` in `packages/config/src/worker.ts`. Each entry needs a `url` and a `template`, and FlareWatch writes the message for you.

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

Webhook URLs usually contain a secret. Keep them out of a public repo.

A monitor in an active [maintenance window](status-page.md#maintenance) doesn't alert.

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

Email through Resend is sent once, with no retry.

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

| Setting                       | Does                                                    |
| ----------------------------- | ------------------------------------------------------- |
| `gracePeriod`                 | Minutes a monitor stays down before the alert goes out. |
| `timeZone`                    | Time zone for times in messages. Defaults to UTC.       |
| `skipNotificationIds`         | Monitor IDs that never alert.                           |
| `skipErrorChangeNotification` | Don't alert again when a down monitor's error changes.  |
