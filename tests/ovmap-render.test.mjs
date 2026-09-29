import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../modules/mapSources/ovmapTiles.ts', import.meta.url))],
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
});
const { renderOvmapTile } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString('base64')}`);

test('512-pixel OVMAP parent tiles render the four x/y child quadrants', async () => {
  const originals = {
    fetch: globalThis.fetch,
    location: globalThis.location,
    OffscreenCanvas: globalThis.OffscreenCanvas,
    createImageBitmap: globalThis.createImageBitmap,
  };
  const crops = [];
  const requestedTemplates = [];
  class Canvas {
    getContext() {
      return { drawImage: (...args) => crops.push(args.slice(1)) };
    }
    async convertToBlob() { return new Blob([new Uint8Array([1])]); }
  }
  globalThis.location = { origin: 'https://app.example.invalid' };
  globalThis.OffscreenCanvas = Canvas;
  globalThis.createImageBitmap = async () => ({ width: 512, height: 512, close() {} });
  globalThis.fetch = async input => {
    const endpoint = new URL(String(input));
    requestedTemplates.push(endpoint.searchParams.get('url'));
    return { ok: true, arrayBuffer: async () => new Uint8Array([1]).buffer };
  };

  try {
    const layer = {
      tiles: ['https://tiles.example.invalid/{$z-1}/{$x/2}/{$y/2}.png'],
      tileSize: 512,
      minzoom: 0,
      maxzoom: 18,
      subdivide: true,
    };
    const expected = [
      { x: 6, y: 10, crop: [0, 0, 256, 256] },
      { x: 7, y: 10, crop: [256, 0, 256, 256] },
      { x: 6, y: 11, crop: [0, 256, 256, 256] },
      { x: 7, y: 11, crop: [256, 256, 256, 256] },
    ];
    for (const item of expected)
      await renderOvmapTile([layer], 5, item.x, item.y, new AbortController().signal);

    assert.deepEqual(crops.map(args => args.slice(0, 4)), expected.map(item => item.crop));
    assert.deepEqual(requestedTemplates, expected.map(() => 'https://tiles.example.invalid/4/3/5.png'));
    assert.ok(crops.every(args => args.slice(4).join(',') === '0,0,256,256'));
  } finally {
    globalThis.fetch = originals.fetch;
    if (originals.location === undefined) delete globalThis.location;
    else globalThis.location = originals.location;
    if (originals.OffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originals.OffscreenCanvas;
    if (originals.createImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originals.createImageBitmap;
  }
});

test('optional annotation failures preserve the base tile and report a partial result', async t => {
  const originals = {
    fetch: globalThis.fetch,
    location: globalThis.location,
    OffscreenCanvas: globalThis.OffscreenCanvas,
    createImageBitmap: globalThis.createImageBitmap,
  };
  class Canvas {
    getContext() { return { drawImage() {} }; }
    async convertToBlob() { return new Blob([new Uint8Array([9])]); }
  }
  const baseBytes = new Uint8Array([1]).buffer;
  const base = { tiles: ['https://base.example.invalid/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 0, maxzoom: 18, subdivide: false };
  const overlay = { tiles: ['https://labels.example.invalid/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 0, maxzoom: 18, subdivide: false };
  globalThis.location = { origin: 'https://app.example.invalid' };
  globalThis.OffscreenCanvas = Canvas;

  try {
    await t.test('HTTP 502', async () => {
      globalThis.createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
      globalThis.fetch = async input => new URL(String(input)).searchParams.get('url').includes('base.example')
        ? { ok: true, arrayBuffer: async () => baseBytes }
        : { ok: false, status: 502 };
      const partial = [];
      const result = await renderOvmapTile([base, overlay], 5, 6, 10, new AbortController().signal, () => partial.push(1));
      assert.deepEqual([...new Uint8Array(result)], [1]);
      assert.deepEqual(partial, [1]);
    });

    await t.test('overlay fetch throws', async () => {
      globalThis.createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
      globalThis.fetch = async input => {
        if (new URL(String(input)).searchParams.get('url').includes('base.example'))
          return { ok: true, arrayBuffer: async () => baseBytes };
        throw new Error('overlay network failure');
      };
      const partial = [];
      const result = await renderOvmapTile([base, overlay], 5, 6, 10, new AbortController().signal, () => partial.push(1));
      assert.deepEqual([...new Uint8Array(result)], [1]);
      assert.deepEqual(partial, [1]);
    });

    await t.test('overlay bitmap decoding throws', async () => {
      globalThis.fetch = async input => ({ ok: true, arrayBuffer: async () =>
        new URL(String(input)).searchParams.get('url').includes('base.example') ? baseBytes : new Uint8Array([2]).buffer });
      globalThis.createImageBitmap = async blob => {
        if (new Uint8Array(await blob.arrayBuffer())[0] === 2) throw new Error('invalid overlay bitmap');
        return { width: 256, height: 256, close() {} };
      };
      const partial = [];
      const result = await renderOvmapTile([base, overlay], 5, 6, 10, new AbortController().signal, () => partial.push(1));
      assert.deepEqual([...new Uint8Array(result)], [1]);
      assert.deepEqual(partial, [1]);
    });
  } finally {
    globalThis.fetch = originals.fetch;
    if (originals.location === undefined) delete globalThis.location;
    else globalThis.location = originals.location;
    if (originals.OffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originals.OffscreenCanvas;
    if (originals.createImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originals.createImageBitmap;
  }
});

test('base tile failures reject instead of returning an annotation-only tile', async () => {
  const originals = {
    fetch: globalThis.fetch,
    location: globalThis.location,
    OffscreenCanvas: globalThis.OffscreenCanvas,
    createImageBitmap: globalThis.createImageBitmap,
  };
  class Canvas {
    getContext() { return { drawImage() {} }; }
    async convertToBlob() { return new Blob([new Uint8Array([9])]); }
  }
  const base = { tiles: ['https://base.example.invalid/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 0, maxzoom: 18, subdivide: false };
  const overlay = { tiles: ['https://labels.example.invalid/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 0, maxzoom: 18, subdivide: false };
  globalThis.location = { origin: 'https://app.example.invalid' };
  globalThis.OffscreenCanvas = Canvas;
  globalThis.createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
  globalThis.fetch = async input => new URL(String(input)).searchParams.get('url').includes('base.example')
    ? { ok: false, status: 503 }
    : { ok: true, arrayBuffer: async () => new Uint8Array([2]).buffer };
  try {
    await assert.rejects(renderOvmapTile([base, overlay], 5, 6, 10, new AbortController().signal));
  } finally {
    globalThis.fetch = originals.fetch;
    if (originals.location === undefined) delete globalThis.location;
    else globalThis.location = originals.location;
    if (originals.OffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originals.OffscreenCanvas;
    if (originals.createImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originals.createImageBitmap;
  }
});

test('parent abort rejects while an optional annotation request is pending', async () => {
  const originals = {
    fetch: globalThis.fetch,
    location: globalThis.location,
    OffscreenCanvas: globalThis.OffscreenCanvas,
    createImageBitmap: globalThis.createImageBitmap,
  };
  class Canvas {
    getContext() { return { drawImage() {} }; }
    async convertToBlob() { return new Blob([new Uint8Array([9])]); }
  }
  const baseBytes = new Uint8Array([1]).buffer;
  const base = { tiles: ['https://base.example.invalid/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 0, maxzoom: 18, subdivide: false };
  const overlay = { tiles: ['https://labels.example.invalid/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 0, maxzoom: 18, subdivide: false };
  globalThis.location = { origin: 'https://app.example.invalid' };
  globalThis.OffscreenCanvas = Canvas;
  globalThis.createImageBitmap = async () => ({ width: 256, height: 256, close() {} });
  const controller = new AbortController();
  globalThis.fetch = async (input, { signal }) => {
    if (new URL(String(input)).searchParams.get('url').includes('base.example'))
      return { ok: true, arrayBuffer: async () => baseBytes };
    queueMicrotask(() => controller.abort(new Error('parent cancelled')));
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  };
  try {
    await assert.rejects(renderOvmapTile([base, overlay], 5, 6, 10, controller.signal));
  } finally {
    globalThis.fetch = originals.fetch;
    if (originals.location === undefined) delete globalThis.location;
    else globalThis.location = originals.location;
    if (originals.OffscreenCanvas === undefined) delete globalThis.OffscreenCanvas;
    else globalThis.OffscreenCanvas = originals.OffscreenCanvas;
    if (originals.createImageBitmap === undefined) delete globalThis.createImageBitmap;
    else globalThis.createImageBitmap = originals.createImageBitmap;
  }
});
