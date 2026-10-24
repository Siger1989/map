/** Decoded off-screen tiles stay available when panning back. Limits apply per source. */
export const RECENT_TILE_CACHE = {
  maxTileCacheZoomLevels: 8,
  maxTileCacheSize: 256,
} as const;
