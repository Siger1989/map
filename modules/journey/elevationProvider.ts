import { TERRAIN_URL } from '../terrain/terrain';
import type { JourneySample, ElevationSample } from './metrics';
const cache = new Map<string, Uint8ClampedArray>();
export function terrainPixel(coordinate: [number, number]) {
  const [lng, lat] = coordinate,
    n = 4096;
  const tx = (((((lng + 180) % 360) + 360) % 360) / 360) * n;
  const ty = Math.max(
    0,
    Math.min(
      n - 1e-8,
      ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n,
    ),
  );
  return {
    x: Math.floor(tx),
    y: Math.floor(ty),
    pixel: (Math.floor((ty % 1) * 256) * 256 + Math.floor((tx % 1) * 256)) * 4,
  };
}
/** Decode each terrain tile once, with at most three concurrent tile requests. */
export async function readProfile(
  samples: JourneySample[],
  signal: AbortSignal,
): Promise<ElevationSample[]> {
  const groups = new Map<
    string,
    { url: string; entries: { index: number; pixel: number }[] }
  >();
  samples.forEach((s, index) => {
    const p = terrainPixel(s.coordinates),
      key = `${p.x}/${p.y}`;
    if (!groups.has(key))
      groups.set(key, {
        url: TERRAIN_URL.replace('{z}', '12')
          .replace('{x}', String(p.x))
          .replace('{y}', String(p.y)),
        entries: [],
      });
    groups.get(key)!.entries.push({ index, pixel: p.pixel });
  });
  const result = samples.map((s) => ({
      ...s,
      elevation: null as number | null,
    })),
    queue = [...groups.entries()];
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (queue.length) {
        signal.throwIfAborted();
        const [key, group] = queue.shift()!;
        try {
          let rgba = cache.get(key);
          if (!rgba) {
            const response = await fetch(group.url, {
              signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]),
            });
            if (!response.ok) continue;
            const bitmap = await createImageBitmap(await response.blob());
            try {
              const canvas = document.createElement('canvas');
              canvas.width = canvas.height = 256;
              const context = canvas.getContext('2d', {
                willReadFrequently: true,
              });
              if (!context) continue;
              context.drawImage(bitmap, 0, 0, 256, 256);
              rgba = context.getImageData(0, 0, 256, 256).data;
            } finally {
              bitmap.close();
            }
            if (cache.size >= 24) cache.delete(cache.keys().next().value!);
            cache.set(key, rgba);
          }
          for (const { index, pixel } of group.entries)
            if (rgba[pixel + 3])
              result[index].elevation =
                rgba[pixel] * 256 +
                rgba[pixel + 1] +
                rgba[pixel + 2] / 256 -
                32768;
        } catch {
          signal.throwIfAborted(); /* A failed tile stays missing, never sea level. */
        }
      }
    }),
  );
  return result;
}
