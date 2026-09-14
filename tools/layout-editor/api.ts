import { resolve } from 'node:path';
import { createDesktopServer } from '../../desktop-web/server';

/** Preview only: reuse the existing four local map APIs without compiling the whole website. */
const root = process.env.SHANTU_LAYOUT_ROOT;
if (!root) throw Error('SHANTU_LAYOUT_ROOT is required');
const server = createDesktopServer(resolve(root, 'public'));
server.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(3108, '127.0.0.1', () =>
  console.log('山兔布局地图接口已就绪：127.0.0.1:3108'),
);
