import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
export function browserRuntime() {
  try {
    return require(process.env.GUANYUN_PLAYWRIGHT || 'playwright');
  } catch (error) {
    if (process.env.GUANYUN_PLAYWRIGHT) throw error;
    return require(
      join(
        homedir(),
        '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright',
      ),
    );
  }
}
