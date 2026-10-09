import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTestHarness as createRealTestHarness,
  unstable_startWorker as startRealWorker,
} from '@flarewatch/unwrapped-wrangler';

export * from '@flarewatch/unwrapped-wrangler';

// Wrangler writes .wrangler next to its config. A copy outside the repo keeps the task cache fingerprint stable.
function copyOutsideRepo(config: string): string {
  const copy = path.join(mkdtempSync(path.join(tmpdir(), 'flarewatch-workerd-')), 'wrangler.toml');
  const toml = readFileSync(config, 'utf8').replace(
    /^main = "(.*)"$/m,
    (_, main: string) => `main = ${JSON.stringify(path.resolve(path.dirname(config), main))}`,
  );
  writeFileSync(copy, toml);
  return copy;
}

export const createTestHarness: typeof createRealTestHarness = (options) => {
  if (!options) return createRealTestHarness(options);
  const root = options.root ?? process.cwd();
  return createRealTestHarness({
    ...options,
    workers: options.workers.map((worker) =>
      'configPath' in worker
        ? {
            ...worker,
            configPath: copyOutsideRepo(
              path.resolve(
                root,
                typeof worker.configPath === 'string'
                  ? worker.configPath
                  : fileURLToPath(worker.configPath.href),
              ),
            ),
          }
        : worker,
    ),
  });
};

export function unstable_startWorker({
  config,
  ...options
}: Parameters<typeof startRealWorker>[0] & { config?: string }) {
  return startRealWorker({ ...options, config: config && copyOutsideRepo(config) });
}
