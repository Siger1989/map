import {
  TIANDITU_LAYERS,
  type TiandituLayer,
} from '../cartography/tianditu.ts';
import {
  basemapConfiguration,
  tiandituTiles,
} from '../cartography/basemaps.ts';

export function tdtResource(
  layer: TiandituLayer,
  z: number,
  x: number,
  y: number,
) {
  return `tdt:${layer}:${z}:${x}:${y}`;
}
function parts(value: string) {
  const m = /^tdt:(vec|img|ter|cva|cia|cta|ibo):(\d+):(\d+):(\d+)$/.exec(value);
  return m
    ? {
        layer: m[1] as TiandituLayer,
        z: Number(m[2]),
        x: Number(m[3]),
        y: Number(m[4]),
      }
    : null;
}
export function tdtIdentity(value: string): string | null {
  if (parts(value)) return value;
  try {
    const u = new URL(value);
    if (!/^t[0-7]\.tianditu\.gov\.cn$/.test(u.hostname)) return null;
    const p = Object.fromEntries(
      [...u.searchParams].map(([k, v]) => [k.toLowerCase(), v]),
    );
    const layer = p.layer as TiandituLayer;
    if (
      p.request?.toLowerCase() !== 'gettile' ||
      p.tilematrixset !== 'w' ||
      !Object.hasOwn(TIANDITU_LAYERS, layer)
    )
      return null;
    if (
      ![p.tilematrix, p.tilecol, p.tilerow].every((v) => /^\d+$/.test(v ?? ''))
    )
      return null;
    return tdtResource(
      layer,
      Number(p.tilematrix),
      Number(p.tilecol),
      Number(p.tilerow),
    );
  } catch {
    return null;
  }
}
export function resourceCacheKey(value: string) {
  const id = tdtIdentity(value);
  return id
    ? `https://offline.shantu.invalid/${id.replaceAll(':', '/')}`
    : value;
}
export function resourceFetchUrl(value: string) {
  const tile = parts(value);
  if (!tile) return value;
  const { token, domestic } = basemapConfiguration();
  if (!domestic) throw new Error('未配置天地图 Key');
  return tiandituTiles(tile.layer, token)[0]
    .replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y));
}
export async function validateTileResponse(value: string, response: Response) {
  if (!response.ok)
    throw new Error(
      tdtIdentity(value)
        ? [401, 403, 429].includes(response.status)
          ? '天地图授权或配额不足，下载已暂停'
          : `天地图服务返回 ${response.status}，下载已暂停`
        : `下载失败 (${response.status})`,
    );
  const data = await response.clone().arrayBuffer();
  if (tdtIdentity(value)) {
    const b = new Uint8Array(data);
    if (
      !(
        (b[0] === 137 && b[1] === 80 && b[2] === 78 && b[3] === 71) ||
        (b[0] === 255 && b[1] === 216)
      )
    )
      throw new Error('天地图未返回有效瓦片，可能是授权或配额限制；下载已暂停');
  }
  return data.byteLength;
}
