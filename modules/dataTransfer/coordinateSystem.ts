import type { Coordinate } from '../navigation/types';
export type ImportCoordinates = 'auto' | 'cgcs2000' | 'gcj02';

// The one-step GCJ-02 inverse from Wandergis/coordtransform 2.1.2 (MIT).
// Keep this small importer self-contained: importing its UMD bundle here
// creates a circular static chunk with the Android entry during Vite build.
const PI = Math.PI, EARTH_RADIUS = 6378245, ECCENTRICITY = 0.00669342162296594323;
function latitudeDelta(lng: number, lat: number) {
  let value = -100 + 2 * lng + 3 * lat + .2 * lat * lat + .1 * lng * lat + .2 * Math.sqrt(Math.abs(lng));
  value += (20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2 / 3;
  value += (20 * Math.sin(lat * PI) + 40 * Math.sin(lat / 3 * PI)) * 2 / 3;
  value += (160 * Math.sin(lat / 12 * PI) + 320 * Math.sin(lat * PI / 30)) * 2 / 3;
  return value;
}
function longitudeDelta(lng: number, lat: number) {
  let value = 300 + lng + 2 * lat + .1 * lng * lng + .1 * lng * lat + .1 * Math.sqrt(Math.abs(lng));
  value += (20 * Math.sin(6 * lng * PI) + 20 * Math.sin(2 * lng * PI)) * 2 / 3;
  value += (20 * Math.sin(lng * PI) + 40 * Math.sin(lng / 3 * PI)) * 2 / 3;
  value += (150 * Math.sin(lng / 12 * PI) + 300 * Math.sin(lng / 30 * PI)) * 2 / 3;
  return value;
}
function gcj02ToWgs84([lng, lat]: Coordinate): Coordinate {
  if (!(lng > 73.66 && lng < 135.05 && lat > 3.86 && lat < 53.55))
    return [lng, lat];
  const x = lng - 105, y = lat - 35, radians = lat / 180 * PI;
  const magic = 1 - ECCENTRICITY * Math.sin(radians) ** 2;
  const root = Math.sqrt(magic);
  const dlat = latitudeDelta(x, y) * 180 / (EARTH_RADIUS * (1 - ECCENTRICITY) / (magic * root) * PI);
  const dlng = longitudeDelta(x, y) * 180 / (EARTH_RADIUS / root * Math.cos(radians) * PI);
  return [lng * 2 - (lng + dlng), lat * 2 - (lat + dlat)];
}
export function importCoordinate(
  point: Coordinate,
  system: ImportCoordinates,
): Coordinate {
  if (system === 'auto')
    throw new Error(
      '奥维文件无法仅凭扩展名判断坐标系；请按导出设置选择CGCS2000或GCJ02后重新导入',
    );
  return system === 'gcj02'
    ? gcj02ToWgs84(point)
    : [...point];
}
