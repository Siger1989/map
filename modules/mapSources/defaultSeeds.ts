import { onlineDraft } from './online.ts';
import { supportedOvmapTemplate } from './ovmapTemplates.ts';
import { MAX_CONFIG_BYTES, MAX_MAPS, MAX_STORAGE_BYTES, plainText, validBounds, type MapDraft, type MapSource } from './types.ts';

export const DEFAULT_SEED_ASSET = '/native/default-map-sources.json';

export type DefaultSeedBundle = { drafts: MapDraft[]; legacyMapCount: number };

function validOvmaps(draft: Record<string, unknown>): boolean {
  const ovmap = draft.ovmap;
  if (!ovmap || typeof ovmap !== 'object' || Array.isArray(ovmap)) return false;
  const layers = (ovmap as { layers?: unknown }).layers;
  if (!Array.isArray(layers) || !layers.length || layers.length > 8) return false;
  for (const layer of layers) {
    if (!layer || typeof layer !== 'object' || Array.isArray(layer)) return false;
    const item = layer as Record<string, unknown>;
    if (!Array.isArray(item.tiles) || !item.tiles.length || item.tiles.length > 8) return false;
    if (![256, 512].includes(Number(item.tileSize)) ||
      !Number.isInteger(item.minzoom) || !Number.isInteger(item.maxzoom) ||
      Number(item.minzoom) < 0 || Number(item.maxzoom) > 24 || Number(item.maxzoom) < Number(item.minzoom)) return false;
    for (const raw of item.tiles) {
      if (!safeOvmUrl(raw)) return false;
    }
  }
  for (const key of ['sourceId', 'coordType', 'declaredTileSize']) {
    const value = (ovmap as Record<string, unknown>)[key];
    if (value !== undefined && (!Number.isInteger(value) || Number(value) < 0)) return false;
  }
  for (const key of ['missingOverlayIds', 'overlayIds', 'overlayFlags']) {
    const value = (ovmap as Record<string, unknown>)[key];
    if (value !== undefined && (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || Number(item) < 0))) return false;
  }
  return true;
}

function safeOvmUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string' || raw.length > 8192 || !/\{\$?[xyz](?:[+*/-]\d+)?\}|\{\$Galileo\}/i.test(raw) || !supportedOvmapTemplate(raw)) return false;
  try {
    const parsed = new URL(raw.replace(/\{[^}]+\}/g, '0'));
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.hash;
  } catch { return false; }
}

function validateSeedDraft(value: unknown, index: number): MapDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`第 ${index + 1} 项格式无效`);
  const item = value as Record<string, unknown>;
  if ('blob' in item || item.kind !== 'online') throw new Error(`第 ${index + 1} 项不是在线栅格图源`);
  const hasOvmap = item.format === 'OVMAP' || item.ovmap !== undefined;
  let draft: MapDraft;
  if (hasOvmap) {
    if (!validOvmaps(item)) throw new Error(`第 ${index + 1} 项 OVMAP 模板无效`);
    const rawTiles = item.tiles;
    if (!Array.isArray(rawTiles) || !rawTiles.length || rawTiles.length > 8 || rawTiles.some((url) => !safeOvmUrl(url))) throw new Error(`第 ${index + 1} 项瓦片列表无效`);
    const layers = item.ovmap as NonNullable<MapDraft['ovmap']>;
    const bounds = item.bounds === undefined ? undefined : validBounds(item.bounds);
    if (item.bounds !== undefined && !bounds) throw new Error(`第 ${index + 1} 项范围无效`);
    const minzoom = Number(item.minzoom), maxzoom = Number(item.maxzoom), tileSize = Number(item.tileSize);
    if (!Number.isInteger(minzoom) || !Number.isInteger(maxzoom) || minzoom < 0 || maxzoom > 24 || maxzoom < minzoom || ![256, 512].includes(tileSize)) throw new Error(`第 ${index + 1} 项缩放或瓦片尺寸无效`);
    if (item.datum !== undefined && !['wgs84', 'gcj02', 'bd09'].includes(String(item.datum))) throw new Error(`第 ${index + 1} 项坐标系无效`);
    draft = { name: plainText(item.name), kind: 'online', format: 'OVMAP', attribution: plainText(item.attribution), minzoom, maxzoom, tileSize, scheme: item.scheme === 'tms' ? 'tms' : 'xyz', tiles: rawTiles as string[], ovmap: layers, ...(bounds ? { bounds } : {}), ...(item.datum ? { datum: item.datum as MapDraft['datum'] } : {}), ...(typeof item.detail === 'string' ? { detail: plainText(item.detail) } : {}) };
  } else {
    draft = onlineDraft(item);
    if (draft.kind !== 'online') throw new Error(`第 ${index + 1} 项不是在线图源`);
  }
  if (!draft.name || !draft.attribution) throw new Error(`第 ${index + 1} 项名称或署名为空`);
  const bytes = new TextEncoder().encode(JSON.stringify(draft)).byteLength;
  if (bytes > MAX_STORAGE_BYTES) throw new Error(`第 ${index + 1} 项超过本机存储上限`);
  return draft;
}

export function parseDefaultSeedBundle(value: unknown): DefaultSeedBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('内置图源文件格式无效');
  const asset = value as Record<string, unknown>;
  if (asset.version !== 1 || !Array.isArray(asset.maps) || asset.maps.length < 1 || asset.maps.length > MAX_MAPS) throw new Error('内置图源文件版本或数量无效');
  const drafts = asset.maps.map(validateSeedDraft);
  const total = drafts.reduce((sum, draft) => sum + new TextEncoder().encode(JSON.stringify(draft)).byteLength, 0);
  if (total > MAX_STORAGE_BYTES) throw new Error('内置图源总量超过本机存储上限');
  const legacyMapCount = asset.legacyMapCount === undefined ? drafts.length : asset.legacyMapCount;
  if (!Number.isInteger(legacyMapCount) || Number(legacyMapCount) < 0 || Number(legacyMapCount) > drafts.length)
    throw new Error('内置图源旧版数量无效');
  return { drafts, legacyMapCount: Number(legacyMapCount) };
}

/** Keep the original array-returning API for existing callers and tests. */
export function parseDefaultSeeds(value: unknown): MapDraft[] {
  return parseDefaultSeedBundle(value).drafts;
}

function mayLoadDefaultSeedAsset(): boolean {
  if (typeof location === 'undefined') return false;
  if (location.origin === 'https://appassets.androidplatform.net') return true;
  if (process.env.NEXT_PUBLIC_SHANTU_APK_PREVIEW !== '1') return false;
  try {
    const origin = new URL(location.origin);
    if (!['http:', 'https:'].includes(origin.protocol)) return false;
    const hostname = origin.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch { return false; }
}

export async function loadDefaultSeedBundle(): Promise<DefaultSeedBundle | undefined> {
  if (!mayLoadDefaultSeedAsset()) return;
  const response = await fetch(DEFAULT_SEED_ASSET, { credentials: 'omit', cache: 'no-store', redirect: 'error' });
  if (response.status === 404) return;
  if (!response.ok) throw new Error(`读取内置图源失败（${response.status}）`);
  const declared = Number(response.headers.get('content-length'));
  if (declared > MAX_CONFIG_BYTES) throw new Error('内置图源文件超过 1 MB');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('无法读取内置图源文件');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_CONFIG_BYTES) throw new Error('内置图源文件超过 1 MB');
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('内置图源文件不是有效 JSON'); }
  return parseDefaultSeedBundle(parsed);
}

export async function loadDefaultSeeds(): Promise<MapDraft[] | undefined> {
  return (await loadDefaultSeedBundle())?.drafts;
}

/** A seed failure is surfaced while still returning the user's saved maps. */
export async function seedThenList(
  load: () => Promise<MapDraft[] | DefaultSeedBundle | undefined>,
  ensure: (drafts: MapDraft[] | DefaultSeedBundle) => Promise<unknown>,
  list: () => Promise<MapSource[]>,
  onSeedError: (message: string) => void,
): Promise<MapSource[]> {
  try {
    const drafts = await load();
    if (drafts) await ensure(drafts);
  } catch (error) {
    onSeedError(error instanceof Error ? error.message : '内置图源初始化失败');
  }
  return list();
}
