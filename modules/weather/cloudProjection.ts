export type CloudBounds = [number, number, number, number];

export function cloudTileBounds(z: number, x: number, y: number): CloudBounds {
  const n = 2 ** z;
  if (!Number.isInteger(z) || z < 0 || z > 5 || !Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= n || y >= n)
    throw new Error('云图瓦片范围无效');
  const latitude = (row: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * row / n))) * 180 / Math.PI;
  return [x / n * 360 - 180, latitude(y + 1), (x + 1) / n * 360 - 180, latitude(y)];
}

/** Source scanlines are linear in latitude; map scanlines are linear in Mercator Y. */
export function cloudSourceRow(bounds: CloudBounds, outputRow: number, outputHeight: number, sourceHeight: number, sourceBounds: CloudBounds = bounds): number {
  const [, south, , north] = bounds;
  const mercator = (lat: number) => Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360));
  const t = (outputRow + 0.5) / outputHeight;
  const projected = mercator(north) + (mercator(south) - mercator(north)) * t;
  const latitude = (2 * Math.atan(Math.exp(projected)) - Math.PI / 2) * 180 / Math.PI;
  return Math.max(0, Math.min(sourceHeight - 1, (sourceBounds[3] - latitude) / (sourceBounds[3] - sourceBounds[1]) * sourceHeight - 0.5));
}
