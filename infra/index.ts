import * as pulumi from '@pulumi/pulumi';
import * as cloudflare from '@pulumi/cloudflare';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStatusPageBuild } from './status-page-build.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const COMPATIBILITY_DATE = '2025-11-17';
const COMPATIBILITY_FLAGS = ['nodejs_compat'];
const MAIN_MODULE = 'index.js';
const CRON_EVERY_MINUTE = '* * * * *';

const BINDING_NAMES = {
  STATE: 'FLAREWATCH_STATE',
  PROXY_TOKEN: 'FLAREWATCH_PROXY_TOKEN',
  STATUS_PAGE_AUTH: 'FLAREWATCH_STATUS_PAGE_BASIC_AUTH',
  ADMIN_AUTH: 'FLAREWATCH_ADMIN_BASIC_AUTH',
} as const;

const BINDING_TYPES = {
  KV_NAMESPACE: 'kv_namespace',
  SECRET_TEXT: 'secret_text',
} as const;

function createKvBinding(namespaceId: pulumi.Output<string>) {
  return {
    name: BINDING_NAMES.STATE,
    type: BINDING_TYPES.KV_NAMESPACE,
    namespaceId,
  };
}

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

const worker = new cloudflare.WorkersScript('worker', {
  accountId,
  scriptName: `${projectName}_worker`,
  content: workerContent,
  mainModule: MAIN_MODULE,
  compatibilityDate: COMPATIBILITY_DATE,
  compatibilityFlags: COMPATIBILITY_FLAGS,
  bindings: pulumi.output(proxyToken).apply((token) => [
    createKvBinding(kvNamespace.id),
    ...(token
      ? [
          {
            name: BINDING_NAMES.PROXY_TOKEN,
            type: BINDING_TYPES.SECRET_TEXT,
            text: token,
          },
        ]
      : []),
  ]),
});

new cloudflare.WorkersCronTrigger('cron', {
  accountId,
  scriptName: worker.scriptName,
  schedules: [{ cron: CRON_EVERY_MINUTE }],
});

const statusPageBuild = getStatusPageBuild(__dirname, MAIN_MODULE);

const statusPageWorker = new cloudflare.Worker('statusPage', {
  accountId,
  name: projectName,
  observability: { enabled: true },
});

const statusPageVersion = new cloudflare.WorkerVersion('statusPageVersion', {
  accountId,
  workerId: statusPageWorker.name,
  mainModule: MAIN_MODULE,
  compatibilityDate: COMPATIBILITY_DATE,
  compatibilityFlags: COMPATIBILITY_FLAGS,
  assets: {
    directory: statusPageBuild.clientDir,
  },
  bindings: pulumi.all([statusPageBasicAuth, adminBasicAuth]).apply(([spAuth, adminAuth]) => {
    const bindings: cloudflare.types.input.WorkerVersionBinding[] = [
      createKvBinding(kvNamespace.id),
    ];
    if (spAuth) {
      bindings.push({
        name: BINDING_NAMES.STATUS_PAGE_AUTH,
        type: BINDING_TYPES.SECRET_TEXT,
        text: spAuth,
      });
    }
    if (adminAuth) {
      bindings.push({
        name: BINDING_NAMES.ADMIN_AUTH,
        type: BINDING_TYPES.SECRET_TEXT,
        text: adminAuth,
      });
    }
    return bindings;
  }),
  modules: statusPageBuild.modules,
});

const statusPageVersionId = statusPageVersion.id.apply((id) => id.split('/').pop() ?? id);

const statusPageDeployment = new cloudflare.WorkersDeployment('statusPageDeployment', {
  accountId,
  scriptName: statusPageWorker.name,
  strategy: 'percentage',
  versions: [
    {
      percentage: 100,
      versionId: statusPageVersionId,
    },
  ],
});

// Status page routing: custom domain OR workers.dev subdomain
if (customDomain && customDomainZoneId) {
  // Use custom domain (e.g., status.example.com)
  new cloudflare.WorkersCustomDomain(
    'statusPageDomain',
    {
      accountId,
      zoneId: customDomainZoneId,
      hostname: customDomain,
      service: statusPageWorker.name,
    },
    { dependsOn: statusPageDeployment },
  );
} else {
  // Fall back to workers.dev subdomain
  new cloudflare.WorkersScriptSubdomain(
    'statusPageSubdomain',
    {
      accountId,
      scriptName: statusPageWorker.name,
      enabled: true,
    },
    { dependsOn: statusPageDeployment },
  );
}

// Exports
export const kvNamespaceId = kvNamespace.id;
export const workerScriptName = worker.scriptName;
export const statusPageWorkerName = statusPageWorker.name;
