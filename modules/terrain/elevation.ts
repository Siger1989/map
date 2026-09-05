import { TERRAIN_URL } from './terrain';
export async function readElevation(
  lng: number,
  lat: number,
  signal: AbortSignal,
): Promise<number | null> {
  if (Math.abs(lat) > 85) return null;
  const n = 2 ** 12;
  const tx = ((lng + 180) / 360) * n;
  const ty =
    ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const response = await fetch(
    TERRAIN_URL.replace('{z}', '12')
      .replace('{x}', String(Math.floor(tx)))
      .replace('{y}', String(Math.floor(ty))),
    { signal },
  );
  if (!response.ok) return null;
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    const [r, g, b, a] = ctx.getImageData(
      Math.floor((tx % 1) * 256),
      Math.floor((ty % 1) * 256),
      1,
      1,
    ).data;
    return a === 0 ? null : r * 256 + g + b / 256 - 32768;
  } finally {
    bitmap.close();
  }
}
