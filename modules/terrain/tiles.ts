import repairs from './repair-coverage.json' with { type: 'json' };

/** Shared terrain URL/cache revision. Consumers still receive 256px Terrarium. */
export const TERRAIN_URL = '/api/terrain/{z}/{x}/{y}.png?revision=repairs-v1';
const repairedTiles: Record<string, string[]> = repairs;

export function terrainRepairPath(z: number, x: number, y: number): string | null {
  if (![z, x, y].every(Number.isInteger) || z < 0 || x < 0 || y < 0)
    return null;
  return repairedTiles[z]?.includes(`${x}/${y}`)
    ? `/terrain/repairs-v1/${z}/${x}/${y}.png`
    : null;
}

/** Reuse older offline packages outside corrected tiles. Never reuse known bad DEMs. */
export function legacyTerrainCacheUrl(url: string): string | null {
  const parsed = new URL(url);
  const tile = /^\/api\/terrain\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(parsed.pathname);
  if (!tile || parsed.searchParams.get('revision') !== 'repairs-v1') return null;
  if (terrainRepairPath(Number(tile[1]), Number(tile[2]), Number(tile[3]))) return null;
  parsed.searchParams.delete('revision');
  return parsed.href;
}
