# Monitor Worker (`services/worker`)

The monitor Worker. A cron trigger runs it every minute. It checks each monitor, saves the results in the hub, a SQLite Durable Object, and sends alerts. The hub also keeps the heartbeat pings the status page forwards and the maintenance windows you add.

- Monitors and heartbeats: [docs/monitors.md](../../docs/monitors.md)
- Alerts: [docs/alerts.md](../../docs/alerts.md)
- Running it locally: [DEVELOPMENT.md](../../DEVELOPMENT.md#run-it-locally)
