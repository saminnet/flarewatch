import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createTestHarness as createRealTestHarness,
  unstable_startWorker as startRealWorker,
} from '@flarewatch/unwrapped-wrangler';

export * from '@flarewatch/unwrapped-wrangler';

// Wrangler writes .wrangler next to its config. A copy outside the repo keeps the task cache fingerprint stable.
function copyOutsideRepo(config: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'flarewatch-workerd-'));
  const file = path.join(dir, 'wrangler.toml');
  const toml = readFileSync(config, 'utf8').replace(
    /^main = "(.*)"$/m,
    (_, main: string) => `main = ${JSON.stringify(path.resolve(path.dirname(config), main))}`,
  );
  writeFileSync(file, toml);
  return { file, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

export const createTestHarness: typeof createRealTestHarness = (options) => {
  if (!options) return createRealTestHarness(options);
  const root = options.root ?? process.cwd();
  const copies: (() => void)[] = [];
  const harness = createRealTestHarness({
    ...options,
    workers: options.workers.map((worker) => {
      if (!('configPath' in worker)) return worker;
      const copy = copyOutsideRepo(
        path.resolve(
          root,
          typeof worker.configPath === 'string'
            ? worker.configPath
            : fileURLToPath(worker.configPath.href),
        ),
      );
      copies.push(copy.remove);
      return { ...worker, configPath: copy.file };
    }),
  });
  const close = harness.close.bind(harness);
  return Object.assign(harness, {
    close: async () => {
      await close();
      for (const remove of copies) remove();
    },
  });
};

export async function unstable_startWorker({
  config,
  ...options
}: Parameters<typeof startRealWorker>[0] & { config?: string }) {
  const copy = config === undefined ? undefined : copyOutsideRepo(config);
  const worker = await startRealWorker({ ...options, config: copy?.file });
  const dispose = worker.dispose.bind(worker);
  return Object.assign(worker, {
    dispose: async () => {
      await dispose();
      copy?.remove();
    },
  });
}
