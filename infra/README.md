# Infra (Pulumi)

This folder contains FlareWatch infrastructure-as-code.

## Deployment model

Pulumi manages all Cloudflare resources:

| Resource           | Notes                       |
| ------------------ | --------------------------- |
| KV namespace       | Shared state storage        |
| Monitoring Worker  | Runs checks every minute    |
| Cron trigger       | Schedules monitoring Worker |
| Status page Worker | Serves the status page UI   |

All deployments go through `pulumi up`, all teardowns through `pulumi destroy`.

## Pulumi state in Cloudflare R2

FlareWatch uses an S3-compatible Pulumi backend pointing at R2.

You need:

- `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` to provision Cloudflare resources (Workers, KV, cron triggers, and optionally the R2 bucket).
- R2 S3 credentials to set `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` (Dashboard → R2 → Manage R2 API Tokens).
- A bucket for Pulumi state.
  - CI bootstraps it once via `wrangler r2 bucket create ...` (this is the only place Wrangler is used in the deploy workflow).
  - Locally, you can create it via the dashboard or with `wrangler r2 bucket create <name>`.
- `PULUMI_CONFIG_PASSPHRASE` (a random stable passphrase) to encrypt Pulumi secrets in state/config.

Example backend URL:

```bash
export PULUMI_BACKEND_URL="s3://<project>-pulumi-state?endpoint=https://<account_id>.r2.cloudflarestorage.com&region=auto"
```

## Cloudflare API token (recommended scope)

Create a Cloudflare API token that can:

- Create/update Workers scripts
- Create/update Workers KV namespaces
- Create/update Workers cron triggers
- (Optional) create the R2 bucket used for Pulumi state

Scope it to your account. For the first deploy, it’s simplest to allow “all buckets” for R2; once the state bucket exists you can rotate to a token scoped to that bucket.

## Local flow (manual)

```bash
# Build the monitoring worker bundle used by Pulumi.
pnpm worker:build

# Login + select stack.
pulumi -C infra login "$PULUMI_BACKEND_URL"
pulumi -C infra stack select production --create

# Configure.
pulumi -C infra config set accountId "$CLOUDFLARE_ACCOUNT_ID"
pulumi -C infra config set projectName "<your-name>"

# Optional secrets
pulumi -C infra config set --secret proxyToken
pulumi -C infra config set --secret statusPageBasicAuth
pulumi -C infra config set --secret adminBasicAuth

# Provision.
pulumi -C infra up --yes
```

## Configuration Reference

### Required

- `accountId` - Cloudflare account ID
- `projectName` - Name prefix for all resources

### Optional

- `customDomain` - Custom domain for status page (e.g., `status.example.com`)
- `customDomainZoneId` - Zone ID for the custom domain (required if `customDomain` is set)

If no custom domain is configured, the status page uses a workers.dev subdomain.

## Finding your status page URL

- If you configured `customDomain`, visit `https://<customDomain>`.
- Otherwise the Worker is reachable via `workers.dev`:
  - URL format: `https://<projectName>.<your-workers-subdomain>.workers.dev`
  - Find your workers.dev subdomain in Cloudflare Dashboard → Workers & Pages → Overview.

### Optional Secrets

- `proxyToken` - Bearer token for proxy authentication
- `statusPageBasicAuth` - Basic auth for status page (`<username>:<password>`)
- `adminBasicAuth` - Basic auth for admin routes (`<username>:<password>`)

## Destroying

To tear down all resources:

```bash
pulumi -C infra destroy
```
