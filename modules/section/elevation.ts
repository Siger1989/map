import { TERRAIN_URL } from '../terrain/terrain';
import { clippedTerrain, decodeTerrain, type TerrainTile } from './terrainMath';

/** Native tile selection limits work to the camera frustum and seam neighbours. */
export class SectionTerrainStore {
  private cache = new Map<string, Float32Array>();
  private active = 0;
  private waiting = new Set<() => void>();
  async read(tile: TerrainTile, signal: AbortSignal): Promise<Float32Array> {
    const key = `${tile.z}/${tile.x}/${tile.y}`;
    while (this.active >= 3) {
      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(signal.reason);
        };
        const cleanup = () => {
          this.waiting.delete(finish);
          signal.removeEventListener('abort', abort);
        };
        this.waiting.add(finish);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
    signal.throwIfAborted();
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    this.active++;
    try {
      const response = await fetch(
        TERRAIN_URL.replace('{z}', String(tile.z))
          .replace('{x}', String(tile.x))
          .replace('{y}', String(tile.y)),
        {
          signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
        },
      );
      if (!response.ok) throw new Error(`地形读取失败 (${response.status})`);
      const bitmap = await createImageBitmap(await response.blob(), {
        colorSpaceConversion: 'none',
      });
      let heights: Float32Array;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('无法读取地形');
        context.drawImage(bitmap, 0, 0, 256, 256);
        heights = decodeTerrain(context.getImageData(0, 0, 256, 256).data);
      } finally {
        bitmap.close();
      }
      signal.throwIfAborted();
      if (this.cache.size >= 48)
        this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, heights);
      return heights;
    } finally {
      this.active--;
      for (const wake of [...this.waiting]) wake();
    }
  }
  image(heights: Float32Array, altitude: number): Promise<ImageBitmap> {
    return createImageBitmap(
      new ImageData(clippedTerrain(heights, altitude), 256, 256),
      { colorSpaceConversion: 'none' },
    );
  }
  clear() {
    this.cache.clear();
  }
}
