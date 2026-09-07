/** Build-time lossless compression. Run on an unsigned APK BEFORE zipalign/signing.
 * Uses Node and the existing fflate dependency; never edits source terrain files.
 * PNG filter bytes, all non-IDAT chunks, and decoded elevation pixels stay exact.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { unzipSync, zipSync } from 'fflate';

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

export function optimizePng(input) {
  const png = Buffer.from(input);
  if (!png.subarray(0, 8).equals(signature)) throw new Error('Invalid PNG signature');
  const chunks = [];
  for (let offset = 8; offset < png.length;) {
    if (offset + 12 > png.length) throw new Error('Truncated PNG chunk');
    const size = png.readUInt32BE(offset);
    const end = offset + size + 12;
    if (end > png.length) throw new Error('Truncated PNG data');
    if (crc32(png.subarray(offset + 4, end - 4)) !== png.readUInt32BE(end - 4)) {
      throw new Error('PNG CRC mismatch');
    }
    chunks.push({ type: png.toString('ascii', offset + 4, offset + 8),
      raw: png.subarray(offset, end), data: png.subarray(offset + 8, end - 4) });
    offset = end;
  }
  if (chunks[0]?.type !== 'IHDR' || chunks.at(-1)?.type !== 'IEND') throw new Error('Invalid PNG structure');
  const idats = chunks.filter(chunk => chunk.type === 'IDAT');
  if (!idats.length) throw new Error('Missing PNG image data');
  const scanlines = inflateSync(Buffer.concat(idats.map(chunk => chunk.data)), { maxOutputLength: 64 * 1024 * 1024 });
  const compressed = deflateSync(scanlines, { level: 9 });
  // Verify the exact filtered stream, which also preserves every elevation channel.
  if (!inflateSync(compressed).equals(scanlines)) throw new Error('PNG round-trip mismatch');
  const idat = Buffer.alloc(compressed.length + 12);
  idat.writeUInt32BE(compressed.length);
  idat.write('IDAT', 4);
  compressed.copy(idat, 8);
  idat.writeUInt32BE(crc32(idat.subarray(4, -4)), idat.length - 4);
  let written = false;
  const result = Buffer.concat([signature, ...chunks.flatMap(chunk => {
    if (chunk.type !== 'IDAT') return [chunk.raw];
    if (written) return [];
    written = true;
    return [idat];
  })]);
  return result.length < png.length ? result : png;
}

export function optimizeApk(input) {
  const entries = unzipSync(input);
  const output = Object.create(null);
  let pngCount = 0, pngBytesSaved = 0;
  for (const [name, original] of Object.entries(entries)) {
    if (/^META-INF\//i.test(name)) throw new Error('Expected an unsigned APK');
    if (name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) throw new Error('Invalid APK entry path');
    let bytes = original;
    if (name.startsWith('assets/terrain/') && name.endsWith('.png')) {
      bytes = optimizePng(original);
      pngCount++;
      pngBytesSaved += original.length - bytes.length;
    }
    // Android 11+ requires resources.arsc to remain uncompressed and aligned.
    const store = name === 'resources.arsc' || /^lib\/.+\.so$/.test(name) || /\.png$/.test(name);
    output[name] = [bytes, { level: store ? 0 : 9 }];
  }
  const apk = zipSync(output);
  const verified = unzipSync(apk);
  for (const [name, [expected]] of Object.entries(output)) {
    if (!Buffer.from(verified[name]).equals(Buffer.from(expected))) throw new Error(`APK round-trip mismatch: ${name}`);
  }
  return { apk, report: { entries: Object.keys(output).length, pngCount, pngBytesSaved,
    beforeBytes: input.length, afterBytes: apk.length, savedBytes: input.length - apk.length } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination || resolve(source) === resolve(destination)) throw new Error('Usage: node scripts/optimize-apk.mjs unsigned.apk optimized.apk');
  const { apk, report } = optimizeApk(readFileSync(source));
  writeFileSync(destination, apk);
  console.log(JSON.stringify(report));
}
