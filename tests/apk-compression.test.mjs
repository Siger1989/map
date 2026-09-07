import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { zipSync, unzipSync } from 'fflate';
import { optimizePng, optimizeApk } from '../scripts/optimize-apk.mjs';

// Fixed independent PNG fixture: valid CRCs, RGB elevation channels, multiple IDATs.
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAAGHRFWHRTb3VyY2UARWxldmF0aW9uIGZpeHR1cmVvSMZLAAAAB0lEQVR4AQEEAPv/NcX/0QAAAAhJREFUAIAA/wKDAYAR46/KAAAAAElFTkSuQmCC', 'base64');
function chunks(bytes) {
  const result = [];
  for (let pos = 8; pos < bytes.length;) {
    const length = bytes.readUInt32BE(pos);
    result.push({ type: bytes.toString('ascii', pos + 4, pos + 8), data: bytes.subarray(pos + 8, pos + 8 + length) });
    pos += length + 12;
  }
  return result;
}
function imageData(bytes) {
  return inflateSync(Buffer.concat(chunks(bytes).filter(chunk => chunk.type === 'IDAT').map(chunk => chunk.data)));
}
test('PNG compression preserves exact RGB elevation channels and metadata', () => {
  const output = optimizePng(png);
  assert.ok(output.length <= png.length);
  assert.deepEqual(imageData(output), Buffer.from([0, 128, 0, 255]));
  assert.deepEqual(chunks(output).filter(chunk => chunk.type !== 'IDAT'), chunks(png).filter(chunk => chunk.type !== 'IDAT'));
});
test('Corrupted or truncated PNG input stops the build', () => {
  const broken = Buffer.from(png); broken[20] ^= 1;
  assert.throws(() => optimizePng(broken), /CRC/);
  assert.throws(() => optimizePng(png.subarray(0, -2)), /Truncated/);
});
test('APK preserves asset contents and stores resources.arsc uncompressed', () => {
  const fixture = { 'AndroidManifest.xml': new Uint8Array([1, 2]),
    'resources.arsc': new Uint8Array(512), 'classes.dex': new Uint8Array([3, 4]),
    'assets/terrain/test.png': png, 'assets/index.html': Buffer.from('<html>山兔</html>') };
  const input = zipSync(fixture);
  const { apk, report } = optimizeApk(input);
  const unpacked = unzipSync(apk);
  assert.deepEqual(Object.keys(unpacked).sort(), Object.keys(fixture).sort());
  for (const [name, bytes] of Object.entries(fixture)) {
    if (name.endsWith('.png')) assert.deepEqual(imageData(Buffer.from(unpacked[name])), imageData(bytes));
    else assert.deepEqual(Buffer.from(unpacked[name]), Buffer.from(bytes));
  }
  // Read central-directory compression methods independently of the ZIP writer.
  const archive = Buffer.from(apk);
  const methods = new Map();
  for (let i = 0; i + 46 < archive.length; i++) {
    if (archive.readUInt32LE(i) !== 0x02014b50) continue;
    const nameLength = archive.readUInt16LE(i + 28);
    methods.set(archive.toString('utf8', i + 46, i + 46 + nameLength), archive.readUInt16LE(i + 10));
  }
  assert.equal(methods.get('resources.arsc'), 0);
  assert.equal(methods.get('assets/terrain/test.png'), 0);
  assert.equal(report.pngCount, 1);
});
test('Compression rejects signed APKs and traversal paths', () => {
  assert.throws(() => optimizeApk(zipSync({ 'META-INF/CERT.RSA': new Uint8Array([1]) })), /unsigned/);
  assert.throws(() => optimizeApk(zipSync({ '../outside': new Uint8Array([1]) })), /path/);
});
