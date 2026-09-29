import { Unzlib } from 'fflate';
import { supportedOvmapTemplate } from './ovmapTemplates.ts';
import {
  MAX_CONFIG_BYTES,
  MAX_MAPS,
  plainText,
  type MapDraft,
  type OvmapTileLayer,
} from './types.ts';

const HEADER_BYTES = 24;
const MAX_INFLATED_BYTES = 4 * 1024 * 1024;
const MAX_FRAME_BYTES = 64 * 1024;
const MAX_NAME_BYTES = 1024;
const MAX_HOST_BYTES = 512;
const MAX_PATH_BYTES = 8192;
const FRAME_TYPE = 37;
const BODY_REVISION = 102;
const BODY_STRINGS_OFFSET = 120;
const TLS_FLAG = 0x10000;
const CHUNK_BYTES = 1024;

type OvmapRecord = {
  id: number;
  index: number;
  frameStart: number;
  frameLength: number;
  frameType: number;
  revision: number;
  minzoom: number;
  maxzoom: number;
  coordType: number;
  tileFormat: number;
  port: number;
  hostStart: number;
  hostEnd: number;
  tileSize: number;
  overlayBig: number;
  overlaySmall: number;
  layerFlags: number;
  overlayFlags: number[];
  tls: boolean;
  name: string;
  host: string;
  path: string;
};

export type OvmapImportResult = {
  drafts: MapDraft[];
  skipped: { name: string; reason: string }[];
  total: number;
};

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length)
    throw new Error('OVMAP 文件结构不完整');
  return new DataView(
    bytes.buffer,
    bytes.byteOffset + offset,
    4,
  ).getUint32(0, true);
}

function decodeUtf8(bytes: Uint8Array, start: number, length: number): string {
  if (length < 1 || start < 0 || start + length > bytes.length)
    throw new Error('字符串长度超出图源记录范围');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(start, start + length),
    );
  } catch {
    throw new Error('图源文本不是有效UTF-8');
  }
}

function inflateBounded(compressed: Uint8Array, expected: number): Uint8Array {
  if (expected < 1 || expected > MAX_INFLATED_BYTES)
    throw new Error('OVMAP 解压数据超过安全上限');
  const chunks: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  const inflater = new Unzlib((chunk) => {
    total += chunk.length;
    if (total > expected || total > MAX_INFLATED_BYTES) {
      overflow = true;
      throw new Error('OVMAP 解压长度超出文件头声明');
    }
    chunks.push(chunk.slice());
  });
  try {
    for (let offset = 0; offset < compressed.length; offset += CHUNK_BYTES) {
      const end = Math.min(offset + CHUNK_BYTES, compressed.length);
      inflater.push(compressed.subarray(offset, end), end === compressed.length);
    }
  } catch (error) {
    if (overflow) throw new Error('OVMAP 解压长度超出文件头声明');
    throw new Error('OVMAP zlib 数据无效');
  }
  if (total !== expected) throw new Error('OVMAP 解压长度与文件头不一致');
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  // fflate's streaming decoder does not verify the zlib checksum itself.
  if (compressed.length < 6) throw new Error('OVMAP zlib 数据不完整');
  let a = 1, b = 0;
  for (const value of output) { a = (a + value) % 65521; b = (b + a) % 65521; }
  const checksum = ((b << 16) | a) >>> 0;
  // OviO v104 exports may append a 16-byte opaque footer after the zlib
  // stream. It is not the Adler-32 checksum. Accept only these two bounded
  // layouts and still check the decompressed payload's actual checksum.
  const checksumMatches = [0, 16].some(footerBytes => {
    const position = compressed.length - footerBytes - 4;
    return position >= 2 && new DataView(compressed.buffer, compressed.byteOffset + position, 4).getUint32(0, false) === checksum;
  });
  if (!checksumMatches) throw new Error('OVMAP 校验失败，文件可能损坏');
  return output;
}

function readRecord(
  payload: Uint8Array,
  frameStart: number,
  frameLength: number,
  frameType: number,
  index: number,
): OvmapRecord {
  const bodyStart = frameStart + 8;
  const frameEnd = bodyStart + frameLength;
  if (frameType !== FRAME_TYPE)
    throw new Error('暂不支持此 OVMAP 图源记录类型');
  if (frameLength < BODY_STRINGS_OFFSET + 12)
    throw new Error('图源记录长度不足');
  const revision = readU32(payload, bodyStart + 4);
  if (readU32(payload, bodyStart) !== FRAME_TYPE || revision !== BODY_REVISION)
    throw new Error('暂不支持此 OVMAP 图源记录版本');

  const minzoom = readU32(payload, bodyStart + 20);
  const maxzoom = readU32(payload, bodyStart + 24);
  const coordType = readU32(payload, bodyStart + 28);
  const tileFormat = readU32(payload, bodyStart + 32);
  const packedHost = readU32(payload, bodyStart + 36);
  const port = packedHost & 0xffff;
  const hostStart = (packedHost >>> 16) & 0xff;
  const hostEnd = (packedHost >>> 24) & 0xff;
  const tileSize = readU32(payload, bodyStart + 40);
  const overlayBig = readU32(payload, bodyStart + 44);
  const overlaySmall = readU32(payload, bodyStart + 48);
  const layerFlags = readU32(payload, bodyStart + 60);
  const tls = (readU32(payload, bodyStart + 64) & TLS_FLAG) !== 0;

  let cursor = bodyStart + BODY_STRINGS_OFFSET;
  if (cursor + 4 > frameEnd) throw new Error('图源名称长度字段缺失');
  const nameLength = readU32(payload, cursor);
  if (nameLength > MAX_NAME_BYTES)
    throw new Error('图源名称超过安全上限');
  cursor += 4;
  if (cursor + nameLength > frameEnd) throw new Error('图源名称超出记录边界');
  const name = plainText(decodeUtf8(payload, cursor, nameLength), '未命名图源');
  cursor += nameLength;

  if (cursor + 4 > frameEnd) throw new Error('图源主机名长度字段缺失');
  const hostLength = readU32(payload, cursor);
  if (hostLength > MAX_HOST_BYTES)
    throw new Error('图源主机名超过安全上限');
  cursor += 4;
  if (cursor + hostLength > frameEnd) throw new Error('图源主机名超出记录边界');
  const host = decodeUtf8(payload, cursor, hostLength);
  cursor += hostLength;

  if (cursor + 4 > frameEnd) throw new Error('图源模板长度字段缺失');
  const pathLength = readU32(payload, cursor);
  if (pathLength > MAX_PATH_BYTES)
    throw new Error('图源模板超过安全上限');
  cursor += 4;
  if (cursor + pathLength > frameEnd) throw new Error('图源模板超出记录边界');
  const path = decodeUtf8(payload, cursor, pathLength);
  cursor += pathLength;
  if (cursor > frameEnd) throw new Error('图源字符串超出记录边界');

  return {
    id: readU32(payload, bodyStart + 16),
    index,
    frameStart,
    frameLength,
    frameType,
    revision,
    minzoom,
    maxzoom,
    coordType,
    tileFormat,
    port,
    hostStart,
    hostEnd,
    tileSize,
    overlayBig,
    overlaySmall,
    layerFlags,
    overlayFlags: [readU32(payload, bodyStart + 52), readU32(payload, bodyStart + 56)],
    tls,
    name,
    host,
    path,
  };
}

function skipReason(record: OvmapRecord): string | undefined {
  if (![0, 1].includes(record.coordType))
    return '此图源使用经纬度投影，当前导入器支持全球/中国墨卡托';
  if (![0, 256, 512].includes(record.tileSize))
    return '此图源的瓦片尺寸尚未支持';
  if (![3, 4].includes(record.tileFormat))
    return '此图源使用未知的栅格图片格式';
  if (record.minzoom > 24 || record.maxzoom > 24 || record.maxzoom < record.minzoom)
    return '此图源的缩放级别超出支持范围';
  if (!record.path.startsWith('/') || /[\u0000-\u001f]/.test(record.path))
    return '图源模板不是安全的相对URL路径';
  if (record.host.includes('://') || /[\s/?#@]/.test(record.host))
    return '图源主机名格式无效';
  return;
}

function expandHosts(record: OvmapRecord): string[] {
  const token = '{$serverpart}';
  if (!record.host.includes(token)) return [record.host];
  const validPart = (value: number) =>
    (value >= 0 && value <= 9) || (value >= 48 && value <= 57) || (value >= 97 && value <= 122);
  if (
    !validPart(record.hostStart) ||
    !validPart(record.hostEnd) ||
    record.hostEnd < record.hostStart ||
    (record.hostStart <= 9) !== (record.hostEnd <= 9) ||
    record.hostEnd - record.hostStart + 1 > 8
  )
    throw new Error('主机编号范围无效或超过8个');
  return Array.from(
    { length: record.hostEnd - record.hostStart + 1 },
    (_, offset) =>
      record.host.replaceAll(token, record.hostStart <= 9 ? String(record.hostStart + offset) : String.fromCharCode(record.hostStart + offset)),
  );
}

function toLayer(record: OvmapRecord): OvmapTileLayer {
  const path = record.path;
  if (!/\{\$?[xyz](?:[+*/-]\d+)?\}/i.test(path)) throw new Error('此项不是瓦片图源');
  if (!supportedOvmapTemplate(path)) throw new Error('图源包含未支持的变量');
  const hasWmts = /(?:[?&](?:service)=wmts\b)/i.test(path);
  if (hasWmts) {
    const matrixSet = [...new URLSearchParams(path.split('?')[1] ?? '')].find(([key]) => key.toLowerCase() === 'tilematrixset')?.[1];
    if (!matrixSet || !['w', 'matrix_w', 'googlemapscompatible'].includes(matrixSet.toLowerCase()))
      throw new Error('WMTS 矩阵集不是已确认的 Web Mercator matrix_w');
  }
  const hosts = expandHosts(record);
  if (!hosts.length || hosts.length > 8)
    throw new Error('主机编号展开后超过图源地址上限');
  const protocol = record.tls ? 'https' : 'http';
  const port = record.port && record.port !== (record.tls ? 443 : 80) ? `:${record.port}` : '';
  const tiles = hosts.map(host => {
    const url = `${protocol}://${host}${port}${path}`;
    const parsed = new URL(url);
    if (parsed.username || parsed.password || !parsed.hostname || parsed.hash) throw new Error('图源地址格式无效');
    return url;
  });
  return { tiles, minzoom: record.minzoom, maxzoom: record.maxzoom, tileSize: record.tileSize || 256,
    ...(/\{\$x\/2\}/i.test(path) && /\{\$y\/2\}/i.test(path) && /\{\$z-1\}/i.test(path) ? { subdivide: true } : {}) };
}

function toDraft(record: OvmapRecord, records: OvmapRecord[]): MapDraft {
  const layers: OvmapTileLayer[] = [toLayer(record)];
  const missing: number[] = [];
  if ((record.layerFlags & 0xff) !== 0) {
    for (const id of new Set([record.overlayBig, record.overlaySmall].filter(Boolean))) {
      if (id === record.id) continue;
      const overlay = records.find(item => item.id === id);
      if (!overlay || skipReason(overlay) || overlay.coordType !== record.coordType) { missing.push(id); continue; }
      try { layers.push(toLayer(overlay)); } catch { missing.push(id); }
    }
  }
  return {
    name: record.name, kind: 'online', format: 'OVMAP',
    tiles: layers[0].tiles, tileSize: 256, scheme: 'xyz',
    minzoom: record.minzoom, maxzoom: record.maxzoom,
    datum: record.coordType === 1 ? 'gcj02' : 'wgs84',
    attribution: '用户提供的 OVMAP 图源',
    ovmap: {
      layers, sourceId: record.id, coordType: record.coordType, declaredTileSize: record.tileSize,
      overlayIds: [record.overlayBig, record.overlaySmall], overlayFlags: record.overlayFlags,
      ...(missing.length ? { missingOverlayIds: missing } : {}),
    },
    ...(missing.length ? { detail: '已导入底图；附加图层不在此合集内' } : {}),
  };
}

/**
 * Read OviMap's bounded zlib container and the supported type-37 custom-map frames.
 * No host is contacted; returned URLs retain the original path and query parameters.
 */
export function parseOvmap(bytes: Uint8Array): OvmapImportResult {
  if (!(bytes instanceof Uint8Array) || bytes.length < HEADER_BYTES)
    throw new Error('OVMAP 文件头不完整');
  if (bytes.length > MAX_CONFIG_BYTES)
    throw new Error('OVMAP 文件不能超过 1 MB');
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'OviO')
    throw new Error('文件不是受支持的 OVMAP 容器');
  if (readU32(bytes, 4) !== bytes.length)
    throw new Error('OVMAP 文件长度与文件头不一致');
  if (readU32(bytes, 12) !== 104 || readU32(bytes, 16) !== 100 || readU32(bytes, 20) !== 0)
    throw new Error('此 OVMAP 的容器版本或封装方式尚未支持');
  const inflatedLength = readU32(bytes, 8);
  const payload = inflateBounded(bytes.subarray(HEADER_BYTES), inflatedLength);

  const drafts: MapDraft[] = [];
  const records: OvmapRecord[] = [];
  const skipped: { name: string; reason: string }[] = [];
  let offset = 0;
  let total = 0;
  while (offset < payload.length) {
    if (total >= MAX_MAPS) throw new Error(`一次最多导入 ${MAX_MAPS} 个图源`);
    if (offset + 8 > payload.length) throw new Error('OVMAP 帧头不完整');
    const frameLength = readU32(payload, offset);
    const frameType = readU32(payload, offset + 4);
    const frameEnd = offset + 8 + frameLength;
    total++;
    if (
      frameLength < BODY_STRINGS_OFFSET + 12 ||
      frameLength > MAX_FRAME_BYTES ||
      frameEnd > payload.length
    )
      throw new Error(`第 ${total} 个 OVMAP 图源记录长度无效`);

    let record: OvmapRecord;
    try {
      record = readRecord(payload, offset, frameLength, frameType, total);
    } catch (error) {
      skipped.push({
        name: `图源 ${total}`,
        reason: error instanceof Error ? error.message : '图源记录无法识别',
      });
      offset = frameEnd;
      continue;
    }
    records.push(record);
    offset = frameEnd;
  }
  for (const record of records) {
    try {
      const reason = skipReason(record);
      if (reason) skipped.push({ name: record.name, reason });
      else drafts.push(toDraft(record, records));
    } catch (error) {
      skipped.push({
        name: record.name,
        reason: error instanceof Error ? error.message : '图源模板无法适配',
      });
    }
  }
  return { drafts, skipped, total };
}
