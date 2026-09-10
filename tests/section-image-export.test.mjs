import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { sectionImageName } from '../modules/section/exportName.ts';

// Exercise the filename contract from the actual Java boundary, not a duplicate whitelist.
const java = await readFile(
  new URL(
    '../mobile/android/src/com/guanyun/weather/NativeBridge.java',
    import.meta.url,
  ),
  'utf8',
);
const match = java.match(/!name\.matches\("((?:\\.|[^"\\])*)"\)/);
assert.ok(match, 'Android photoOutput must have an explicit filename gate');
const accepted = new RegExp(`^(?:${JSON.parse(`"${match[1]}"`)})$`);

test('section overview and appendix export names pass the real Android filename gate', () => {
  assert.equal(
    accepted.test('剖面1-平剖图-1.jpg'),
    false,
    'the old export failed before opening the picker',
  );
  const first = sectionImageName(0, 1789000000000),
    next = sectionImageName(1, 1789000000000);
  assert.notEqual(first, next);
  for (const name of [
    first,
    next,
    sectionImageName(9998, Number.MAX_SAFE_INTEGER),
    'Shantu-photo-123.jpg',
    'Guanyun-measurement-1.jpg',
  ])
    assert.equal(accepted.test(name), true, name);
  for (const name of [
    '../Shantu-section-1-1.jpg',
    'Shantu-section-1-0.jpg',
    'Shantu-section-1-1.jpg.exe',
    'Shantu-section-1-10000.jpg',
    'Shantu-photo-1.jpg\n',
  ])
    assert.equal(accepted.test(name), false, name);
  assert.throws(() => sectionImageName(-1));
  assert.throws(() => sectionImageName(0, NaN));
});

test('section JPEG reaches the native save and share bridge with unchanged image bytes', async () => {
  const bundled = await build({
    entryPoints: ['modules/photos/export.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  const { deliverPhoto } = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
  );
  const originalWindow = globalThis.window,
    originalReader = globalThis.FileReader;
  const calls = [],
    bytes = new Uint8Array([255, 216, 255, 224, 0, 1, 255, 217]);
  globalThis.FileReader = class {
    readAsDataURL(file) {
      file
        .arrayBuffer()
        .then((buffer) => {
          this.result = `data:image/jpeg;base64,${Buffer.from(buffer).toString('base64')}`;
          this.onload();
        })
        .catch(() => this.onerror());
    }
  };
  globalThis.window = {
    GuanyunNative: {
      photoOutput(name, encoded, share) {
        if (!accepted.test(name)) return '分享图片过大或名称无效';
        calls.push({ name, bytes: Buffer.from(encoded, 'base64'), share });
        return 'ok';
      },
    },
  };
  try {
    for (const share of [false, true]) {
      await deliverPhoto(
        new File([bytes], sectionImageName(0, 1789000000000), {
          type: 'image/jpeg',
        }),
        share,
      );
    }
    assert.deepEqual(
      calls.map((c) => c.share),
      [false, true],
    );
    calls.forEach((c) => assert.deepEqual(c.bytes, Buffer.from(bytes)));
    await assert.rejects(
      deliverPhoto(new File([bytes], '剖面1-平剖图-1.jpg'), false),
      /名称无效/,
    );
    assert.equal(
      calls.length,
      2,
      'invalid names must not be reported as successful native requests',
    );
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalReader === undefined) delete globalThis.FileReader;
    else globalThis.FileReader = originalReader;
  }
});
