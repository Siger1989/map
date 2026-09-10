import type { Coordinate } from '../navigation/types.ts';

/** Decimal WGS84 coordinates, consistent with the map's editable latitude range. */
export function surveyPointInput(
  longitude: string,
  latitude: string,
): Coordinate {
  const values = [longitude.trim(), latitude.trim()];
  if (values.some((v) => !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(v)))
    throw new Error('请填写完整的十进制经度和纬度');
  const [lng, lat] = values.map(Number);
  if (!Number.isFinite(lng) || lng < -180 || lng > 180)
    throw new Error('经度范围为 −180 至 180');
  if (!Number.isFinite(lat) || lat < -85 || lat > 85)
    throw new Error('纬度范围为 −85 至 85');
  return [lng, lat];
}
