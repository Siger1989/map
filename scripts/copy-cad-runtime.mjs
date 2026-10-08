import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const packageRoot = resolve(root, 'node_modules/@mlightcad/libredwg-web');
const output = resolve(root, 'public/cad-runtime');
mkdirSync(output, { recursive: true });
copyFileSync(resolve(packageRoot, 'wasm/libredwg-web.js'), resolve(output, 'libredwg-web.js'));
copyFileSync(resolve(packageRoot, 'wasm/libredwg-web.wasm'), resolve(output, 'libredwg-web.wasm'));
copyFileSync(resolve(root, 'modules/cad/LICENSE-GPL-3.0.txt'), resolve(output, 'LICENSE-GPL-3.0.txt'));
writeFileSync(resolve(output, 'NOTICE.txt'), `CAD runtime notices\n\n@mlightcad/libredwg-web 0.7.4 and its bundled LibreDWG WebAssembly decoder are licensed under GNU GPL version 3. The full GPL-3.0 text is in LICENSE-GPL-3.0.txt.\n\nCorresponding source: https://github.com/mlightcad/libredwg-web/tree/v0.7.4 (tag commit 3799e93668e252a4f0742d485f1e813250e0599f) and the LibreDWG source mirror https://github.com/LibreDWG/libredwg. The npm dependency is pinned in package.json/package-lock.json.\n`);
console.log('Copied pinned LibreDWG WebAssembly runtime and GPL notices to public/cad-runtime/.');
