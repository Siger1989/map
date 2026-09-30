import { coordinate, type Coordinate } from '../navigation/types.ts';

export function planBounds(points: Coordinate[]): [number, number, number, number] {
  if (!points.length || !points.every(coordinate))
    throw new Error('请先选择有效路线或地图位置');
  let west = 180,
    south = 85,
    east = -180,
    north = -85;
  for (const [lng, lat] of points) {
    west = Math.min(west, lng);
    east = Math.max(east, lng);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  if (east - west > 2 || north - south > 2)
    throw new Error('范围过大，请分成较短行程下载');
  const padding =
    0.02 / Math.max(0.1, Math.cos((((north + south) / 2) * Math.PI) / 180));
  return [
    Math.max(-180, west - padding),
    Math.max(-85, south - 0.02),
    Math.min(179.999, east + padding),
    Math.min(85, north + 0.02),
  ];
}
