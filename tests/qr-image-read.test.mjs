import test from 'node:test';
import assert from 'node:assert/strict';
import QRCode from 'qrcode';
import { readQr } from '../modules/mapSources/qr.ts';

function qrPixels(text, width, height, qrX, qrY, moduleScale) {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
  const quiet = 4;
  const size = (qr.size + quiet * 2) * moduleScale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let row = 0; row < qr.size; row++) {
    for (let col = 0; col < qr.size; col++) {
      if (!qr.get(row, col)) continue;
      const left = qrX + (col + quiet) * moduleScale;
      const top = qrY + (row + quiet) * moduleScale;
      for (let y = top; y < top + moduleScale; y++) {
        for (let x = left; x < left + moduleScale; x++) {
          const offset = (y * width + x) * 4;
          data[offset] = data[offset + 1] = data[offset + 2] = 0;
        }
      }
    }
  }
  return { data, size };
}

function installCanvasImageMocks(t, source) {
  const oldDocument = globalThis.document;
  const oldCreateImageBitmap = globalThis.createImageBitmap;
  let bitmapClosed = 0;
  let canvases = 0;
  globalThis.document = {
    createElement(name) {
      assert.equal(name, 'canvas');
      canvases++;
      const canvas = { width: 0, height: 0 };
      canvas.getContext = () => ({
        drawImage(image, sx, sy, sw, sh, _dx, _dy, dw, dh) {
          assert.equal(image.width, source.width);
          assert.equal(image.height, source.height);
          assert.equal(image.data, source.data);
          canvas.pixels = new Uint8ClampedArray(dw * dh * 4);
          for (let y = 0; y < dh; y++) {
            const sourceY = Math.min(source.height - 1, sy + Math.floor((y * sh) / dh));
            for (let x = 0; x < dw; x++) {
              const sourceX = Math.min(source.width - 1, sx + Math.floor((x * sw) / dw));
              const from = (sourceY * source.width + sourceX) * 4;
              const to = (y * dw + x) * 4;
              canvas.pixels.set(source.data.subarray(from, from + 4), to);
            }
          }
        },
        getImageData() {
          return { data: canvas.pixels, width: canvas.width, height: canvas.height };
        },
      });
      return canvas;
    },
  };
  globalThis.createImageBitmap = async () => ({
    ...source,
    close() { bitmapClosed++; },
  });
  t.after(() => {
    globalThis.document = oldDocument;
    globalThis.createImageBitmap = oldCreateImageBitmap;
  });
  return { get bitmapClosed() { return bitmapClosed; }, get canvases() { return canvases; } };
}

test('image reader finds a small QR near the top of a long screenshot after the full-image pass', async (t) => {
  const payload = 'ovobj?t=37&fixture=top-position';
  const width = 360, height = 3000;
  const qr = qrPixels(payload, width, height, 130, 100, 2);
  assert.ok(qr.size < 130);
  const source = { width, height, ...qr };
  const mock = installCanvasImageMocks(t, source);

  assert.equal(await readQr({ size: 1024 }), payload);
  assert.ok(mock.canvases > 1, 'small QR should trigger bounded crop retries');
  assert.equal(mock.bitmapClosed, 1);
});

test('image reader finds a small QR in the middle of a long screenshot', async (t) => {
  const payload = 'ovobj?t=37&fixture=middle-position';
  const width = 360, height = 3000;
  const qr = qrPixels(payload, width, height, 130, 1450, 2);
  const source = { width, height, ...qr };
  const mock = installCanvasImageMocks(t, source);

  assert.equal(await readQr({ size: 1024 }), payload);
  assert.ok(mock.canvases > 1, 'small QR should trigger bounded crop retries');
  assert.ok(mock.canvases <= 13, 'full image plus at most twelve crops');
  assert.equal(mock.bitmapClosed, 1);
});

test('image reader keeps the input size cap before decoding', async (t) => {
  const source = { width: 1, height: 1, data: new Uint8ClampedArray(4).fill(255) };
  const mock = installCanvasImageMocks(t, source);
  await assert.rejects(readQr({ size: 20 * 1024 * 1024 + 1 }), /20 MB/);
  assert.equal(mock.canvases, 0);
  assert.equal(mock.bitmapClosed, 0);
});
