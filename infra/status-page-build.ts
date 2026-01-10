import * as fs from 'node:fs';
import * as path from 'node:path';

export type StatusPageModule = {
  name: string;
  contentFile: string;
  contentType: string;
};

export type StatusPageBuild = {
  clientDir: string;
  modules: StatusPageModule[];
};

const MODULE_CONTENT_TYPES: Record<string, string> = {
  '.js': 'application/javascript+module',
  '.mjs': 'application/javascript+module',
  '.cjs': 'application/javascript',
  '.wasm': 'application/wasm',
};

const MODULE_EXTENSIONS = new Set(Object.keys(MODULE_CONTENT_TYPES));

function ensureDir(dir: string, label: string): void {
  if (!fs.existsSync(dir)) {
    throw new Error(`${label} not found at "${dir}". Run: pnpm build`);
  }
}

function listModuleFiles(rootDir: string): string[] {
  const files: string[] = [];
  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) break;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(entryPath);
        continue;
      }
      if (!entry.isFile() || entry.name === '.DS_Store') continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!MODULE_EXTENSIONS.has(ext)) continue;
      files.push(entryPath);
    }
  }
  return files.sort();
}

export function getStatusPageBuild(infraDir: string, mainModule: string): StatusPageBuild {
  const distDir = path.join(infraDir, '../apps/status-page/dist');
  const serverDir = path.join(distDir, 'server');
  const clientDir = path.join(distDir, 'client');

  ensureDir(serverDir, 'Status page server bundle');
  ensureDir(clientDir, 'Status page assets');

  const files = listModuleFiles(serverDir);
  if (files.length === 0) {
    throw new Error(`No status page server modules found in "${serverDir}". Run: pnpm build`);
  }

  const modules = files.map((filePath) => {
    const ext = path.extname(filePath).toLowerCase();
    return {
      name: path.relative(serverDir, filePath).split(path.sep).join('/'),
      contentFile: filePath,
      contentType: MODULE_CONTENT_TYPES[ext] ?? 'text/plain',
    };
  });

  if (!modules.some((module) => module.name === mainModule)) {
    throw new Error(`Status page entry module "${mainModule}" not found in "${serverDir}"`);
  }

  return { clientDir, modules };
}
