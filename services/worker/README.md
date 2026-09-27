# Monitor Worker (`services/worker`)

The monitor Worker. A cron trigger runs it every minute. It checks each monitor, saves the state to the `FLAREWATCH_STATE` KV namespace, and sends alerts. It also records heartbeat pings that the status page forwards to it.

- Monitors and heartbeats: [docs/monitors.md](../../docs/monitors.md)
- Alerts: [docs/alerts.md](../../docs/alerts.md)
- Running it locally: [DEVELOPMENT.md](../../DEVELOPMENT.md#run-it-locally)
