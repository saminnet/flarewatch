import * as pulumi from '@pulumi/pulumi';
import * as cloudflare from '@pulumi/cloudflare';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// ESM __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration (ENVs and secrets)
const config = new pulumi.Config();
const accountId = config.require('accountId');
const customDomain = config.get('customDomain');
const customDomainZoneId = config.get('customDomainZoneId');
const proxyToken = config.getSecret('proxyToken');
const statusPageBasicAuth = config.getSecret('statusPageBasicAuth');
const adminBasicAuth = config.getSecret('adminBasicAuth');
const projectName = config.get('projectName') ?? pulumi.getProject();

// KV Namespace for storing monitor state
const kvNamespace = new cloudflare.WorkersKvNamespace('kv', {
  accountId,
  title: `${projectName}_kv`,
});

// Read the compiled worker script
const workerScriptPath = path.join(__dirname, '../services/worker/dist/index.js');
if (!fs.existsSync(workerScriptPath)) {
  throw new Error(`Worker bundle not found at "${workerScriptPath}". Run: pnpm worker:build`);
}
const workerContent = fs.readFileSync(workerScriptPath, 'utf-8');

// Workers Script for monitoring
const worker = new cloudflare.WorkersScript('worker', {
  accountId,
  scriptName: `${projectName}_worker`,
  content: workerContent,
  mainModule: 'index.js',
  compatibilityDate: '2025-11-17',
  compatibilityFlags: ['nodejs_compat'],
  bindings: pulumi.output(proxyToken).apply((token) => [
    {
      name: 'FLAREWATCH_STATE',
      type: 'kv_namespace',
      namespaceId: kvNamespace.id,
    },
    ...(token
      ? [
          {
            name: 'FLAREWATCH_PROXY_TOKEN',
            type: 'secret_text',
            text: token,
          },
        ]
      : []),
  ]),
});

// Cron trigger for the worker (every minute)
new cloudflare.WorkersCronTrigger('cron', {
  accountId,
  scriptName: worker.scriptName,
  schedules: [{ cron: '* * * * *' }],
});

// Status page Worker
const statusPagePath = path.join(__dirname, '../apps/status-page/dist/server/index.js');
if (!fs.existsSync(statusPagePath)) {
  throw new Error(`Status page bundle not found at "${statusPagePath}". Run: pnpm build`);
}
const statusPageContent = fs.readFileSync(statusPagePath, 'utf-8');

const statusPageWorker = new cloudflare.WorkersScript('statusPage', {
  accountId,
  scriptName: projectName,
  content: statusPageContent,
  mainModule: 'index.js',
  compatibilityDate: '2025-11-17',
  compatibilityFlags: ['nodejs_compat'],
  observability: { enabled: true },
  assets: {
    directory: path.join(__dirname, '../apps/status-page/dist/client'),
  },
  bindings: pulumi.all([statusPageBasicAuth, adminBasicAuth]).apply(([spAuth, adminAuth]) => {
    const bindings: cloudflare.types.input.WorkersScriptBinding[] = [
      {
        name: 'FLAREWATCH_STATE',
        type: 'kv_namespace',
        namespaceId: kvNamespace.id,
      },
    ];
    if (spAuth) {
      bindings.push({
        name: 'FLAREWATCH_STATUS_PAGE_BASIC_AUTH',
        type: 'secret_text',
        text: spAuth,
      });
    }
    if (adminAuth) {
      bindings.push({
        name: 'FLAREWATCH_ADMIN_BASIC_AUTH',
        type: 'secret_text',
        text: adminAuth,
      });
    }
    return bindings;
  }),
});

// Status page routing: custom domain OR workers.dev subdomain
if (customDomain && customDomainZoneId) {
  // Use custom domain (e.g., status.example.com)
  new cloudflare.WorkersCustomDomain('statusPageDomain', {
    accountId,
    zoneId: customDomainZoneId,
    hostname: customDomain,
    service: statusPageWorker.scriptName,
  });
} else {
  // Fall back to workers.dev subdomain
  new cloudflare.WorkersScriptSubdomain('statusPageSubdomain', {
    accountId,
    scriptName: statusPageWorker.scriptName,
    enabled: true,
  });
}

// Exports
export const kvNamespaceId = kvNamespace.id;
export const workerScriptName = worker.scriptName;
export const statusPageWorkerName = statusPageWorker.scriptName;
