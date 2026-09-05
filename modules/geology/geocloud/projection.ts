import type { TileMatrix, WmtsMetadata } from './capabilities';

const EARTH_HALF = 20037508.342789244;
export const tileLatitude = (y: number, zoom: number) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / 2 ** zoom))) * 180 / Math.PI;
export function tileInMatrix(matrix: TileMatrix, col: number, row: number): boolean {
  const limit = matrix.limits;
  return Number.isSafeInteger(col) && Number.isSafeInteger(row) && col >= 0 && row >= 0 && col < matrix.width && row < matrix.height
    && (!limit || col >= limit.minCol && col <= limit.maxCol && row >= limit.minRow && row <= limit.maxRow);
}
export function projectionPlan(metadata: WmtsMetadata, z: number, x: number, y: number) {
  if (![z, x, y].every(Number.isSafeInteger) || z < 0 || z > 20 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) throw new Error('无效地图瓦片坐标');
  const n = 2 ** z;
  const geographic = metadata.projection === 'geographic';
  const unitWidth = geographic ? 360 : EARTH_HALF * 2;
  const requestedResolution = unitWidth / n / 256;
  const candidates = [...metadata.matrices].sort((a, b) => Math.abs(Math.log(a.resolution / requestedResolution)) - Math.abs(Math.log(b.resolution / requestedResolution)));
  for (const matrix of candidates) {
    const xs = Array.from({ length: 256 }, (_, px) => {
      const east = ((x + (px + 0.5) / 256) / n - 0.5) * unitWidth;
      return Math.floor((east - matrix.origin[0]) / matrix.resolution);
    });
    const ys = Array.from({ length: 256 }, (_, py) => {
      const north = geographic ? tileLatitude(y + (py + 0.5) / 256, z) : (0.5 - (y + (py + 0.5) / 256) / n) * unitWidth;
      return Math.floor((matrix.origin[1] - north) / matrix.resolution);
    });
    const minCol = Math.floor(xs[0] / matrix.tileWidth), maxCol = Math.floor(xs[255] / matrix.tileWidth);
    const minRow = Math.floor(ys[0] / matrix.tileHeight), maxRow = Math.floor(ys[255] / matrix.tileHeight);
    if ((maxCol - minCol + 1) * (maxRow - minRow + 1) > 16) continue;
    const tiles: { col: number; row: number }[] = [];
    for (let row = minRow; row <= maxRow; row++) for (let col = minCol; col <= maxCol; col++) {
      if (tileInMatrix(matrix, col, row)) tiles.push({ col, row });
    }
    return { matrix, xs, ys, tiles };
  }
  throw new Error('地图矩阵过于稀疏或不兼容');
}
