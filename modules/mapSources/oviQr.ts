import { ovmapTemplateToLayer } from './ovmap.ts';
import { MAX_CONFIG_BYTES, plainText, type MapDraft } from './types.ts';

const QR_FIELDS = new Set([
  't', 'id', 'na', 'gp', 'po', 'ml', 'pn', 'mt', 'mf', 'pt', 'hn', 'ul',
]);
const MAX_QR_TEXT_BYTES = 100_000;

function decodeBase64Utf8(value: string, field: string): string {
  if (!value || value.length > MAX_QR_TEXT_BYTES || !/^[A-Za-z0-9+/_-]*={0,2}$/.test(value))
    throw new Error(`OVI 二维码的 ${field} 字段不是有效 Base64 文本`);
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const unpadded = normalized.replace(/=+$/, '');
  if (unpadded.length % 4 === 1) throw new Error(`OVI 二维码的 ${field} 字段长度无效`);
  const padded = unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error(`OVI 二维码的 ${field} 字段无法解码`);
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`OVI 二维码的 ${field} 字段不是有效 UTF-8`);
  }
}

function required(fields: URLSearchParams, key: string): string {
  const value = fields.get(key);
  if (value === null || value === '') throw new Error(`OVI 二维码缺少 ${key} 字段`);
  return value;
}

function integerField(fields: URLSearchParams, key: string, min: number, max: number): number {
  const value = required(fields, key);
  if (!/^\d+$/.test(value)) throw new Error(`OVI 二维码的 ${key} 字段不是有效整数`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    throw new Error(`OVI 二维码的 ${key} 字段超出支持范围`);
  return number;
}

/** Import the observed, single-layer OVI type-37 raster QR profile. */
export function parseOviQr(text: string): MapDraft {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > MAX_CONFIG_BYTES)
    throw new Error('OVI 二维码内容超过安全上限');
  const content = text.trim();
  if (!/^ovobj\?/i.test(content)) throw new Error('不是 OVI 自定义地图二维码内容');

  // OVI Base64 values use standard '+' characters. Escape them before URLSearchParams
  // so they are not silently converted to spaces.
  const fields = new URLSearchParams(content.slice(content.indexOf('?') + 1).replace(/\+/g, '%2B'));
  for (const key of fields.keys()) {
    if (!QR_FIELDS.has(key)) {
      if (['at', 'ad', 'al'].includes(key))
        throw new Error('此 OVI 二维码含未支持的专有历史地图数据');
      throw new Error(`此 OVI 二维码含未支持字段：${key.slice(0, 32)}`);
    }
  }
  for (const key of QR_FIELDS) {
    if (fields.getAll(key).length > 1) throw new Error(`OVI 二维码的 ${key} 字段重复`);
  }

  const type = integerField(fields, 't', 0, 65535);
  if (type !== 37) throw new Error(`暂不支持 OVI 二维码类型 ${type}`);
  const sourceId = integerField(fields, 'id', 1, 0xffffffff);
  const category = plainText(decodeBase64Utf8(required(fields, 'gp'), 'gp'));
  const name = plainText(decodeBase64Utf8(required(fields, 'na'), 'na'), 'OVI 自定义地图');
  if (!name) throw new Error('OVI 二维码中的地图名称为空');

  const projection = integerField(fields, 'po', 0, 255);
  if (projection !== 1) {
    if (projection === 3) throw new Error('此 OVI 二维码属于未支持的历史专有图源格式');
    throw new Error(`暂不支持 OVI 投影类型 po=${projection}`);
  }
  const coordType = integerField(fields, 'pn', 0, 1);
  if (integerField(fields, 'mt', 0, 255) !== 1)
    throw new Error('此 OVI 二维码的地图类型尚未支持');
  if (integerField(fields, 'mf', 0, 255) !== 3)
    throw new Error('此 OVI 二维码的栅格格式尚未支持');
  const maxzoom = integerField(fields, 'ml', 0, 24);
  const port = integerField(fields, 'pt', 1, 65535);
  if (port !== 443 && port !== 80)
    throw new Error('OVI 图源端口仅支持 HTTPS 443 或 HTTP 80');

  const host = decodeBase64Utf8(required(fields, 'hn'), 'hn');
  const path = decodeBase64Utf8(required(fields, 'ul'), 'ul');
  if (host.length > 253 || !host || /[\s/?#@:\\]/.test(host) || host.includes('://'))
    throw new Error('OVI 图源主机名不是安全的裸主机名');
  if (!path.startsWith('/') || path.length > 8192 || /[\u0000-\u001f\s#\\]/.test(path))
    throw new Error('OVI 瓦片模板不是安全的相对路径');
  if (!/\{\$?[xyz](?:[+*/-]\d+)?\}/i.test(path))
    throw new Error('此 OVI 二维码未提供可识别的 XYZ 瓦片模板');

  const tls = port === 443;
  // The QR profile does not declare tile pixel size or a minimum zoom. Preserve
  // its XYZ template and declared maximum, using the app's 256px / zoom-0 defaults.
  const minzoom = 0;
  const layer = ovmapTemplateToLayer({
    host,
    path,
    port,
    tls,
    hostStart: 0,
    hostEnd: 0,
    minzoom,
    maxzoom,
    tileSize: 256,
  });
  const tile = layer.tiles[0];
  const url = new URL(tile);
  if (url.username || url.password || url.hash || !url.hostname || url.protocol !== (tls ? 'https:' : 'http:'))
    throw new Error('OVI 图源地址格式无效');

  return {
    name,
    kind: 'online',
    format: 'OVMAP',
    attribution: '用户提供的 OVI 图源二维码',
    minzoom,
    maxzoom,
    tileSize: 256,
    scheme: 'xyz',
    tiles: layer.tiles,
    datum: coordType === 1 ? 'gcj02' : 'wgs84',
    detail: `OVI t37 单层栅格 · ${category || '未分类'} · po=1 · pn=${coordType} · mt=1 · mf=3 · pt=${port} · ml=${maxzoom} · QR未声明最小级别与像素尺寸，按0级/256px处理`,
    ovmap: {
      layers: [layer],
      sourceId,
      coordType,
    },
  };
}
