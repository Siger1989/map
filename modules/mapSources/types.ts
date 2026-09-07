/** User maps are local to this browser/device; existing trip stores are independent. */
export type Bounds = [number, number, number, number];
export type MapSource = {
  id: string;
  name: string;
  kind: 'online' | 'mbtiles' | 'image';
  format: string;
  attribution: string;
  bounds?: Bounds;
  minzoom: number;
  maxzoom: number;
  tileSize: number;
  tiles?: string[];
  scheme?: 'xyz' | 'tms';
  bytes: number;
  detail?: string;
};
export type MapDraft = Omit<MapSource, 'id' | 'bytes'>;
export type StoredMap = MapSource & { blob?: Blob };
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_STORAGE_BYTES = 256 * 1024 * 1024;
export const MAX_MAPS = 20;
export const MAX_CONFIG_BYTES = 1024 * 1024;
export const SOURCE_ID = 'shantu-user-map';

export function validBounds(value: unknown): Bounds | undefined {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every(Number.isFinite)
  )
    return;
  const [w, s, e, n] = value as number[];
  if (
    w >= e ||
    s >= n ||
    w < -180 ||
    e > 180 ||
    s < -85.051129 ||
    n > 85.051129
  )
    return;
  return [w, s, e, n];
}

export function plainText(value: unknown, fallback = ''): string {
  return typeof value === 'string'
    ? value
        .replace(/<[^>]*>/g, '')
        .replace(/[\u0000-\u001f]/g, '')
        .trim()
        .slice(0, 240)
    : fallback;
}
