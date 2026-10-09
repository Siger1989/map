import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const outputRoot = process.argv[2];
if (!outputRoot) throw new Error('Expected a fresh web output directory');

const viteCli = resolve(projectRoot, 'node_modules/vite/bin/vite.js');
const env = { ...process.env, NEXT_PUBLIC_TIANDITU_KEY: '' };
if (env.NEXT_PUBLIC_TIANDITU_KEY !== '') throw new Error('Public map key override failed');

const result = spawnSync(
  process.execPath,
  [viteCli, 'build', '--mode', 'public', '--config', 'mobile/vite.config.ts', '--outDir', resolve(outputRoot)],
  { cwd: projectRoot, env, stdio: 'inherit', windowsHide: true },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
