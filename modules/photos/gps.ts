import { coordinate, type Coordinate } from '../navigation/types.ts';

type ExifGps = Record<string, unknown>;

function rational(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (Array.isArray(value) && value.length === 2) {
    const numerator = rational(value[0]), denominator = rational(value[1]);
    return numerator === null || denominator === null || denominator === 0
      ? null
      : numerator / denominator;
  }
  if (Array.isArray(value) && value.length === 1) return rational(value[0]);
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>;
    if ('numerator' in item && 'denominator' in item) {
      const numerator = rational(item.numerator), denominator = rational(item.denominator);
      return numerator === null || denominator === null || denominator === 0
        ? null
        : numerator / denominator;
    }
  }
  return null;
}

function reference(value: unknown): string | null {
  if (typeof value === 'string') {
    const text = value.replace(/\0/g, '').trim().toUpperCase();
    return text || null;
  }
  if (ArrayBuffer.isView(value)) {
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return String.fromCharCode(...bytes).replace(/\0/g, '').trim().toUpperCase() || null;
  }
  return null;
}

function degrees(value: unknown, refValue: unknown, positiveRef: string, negativeRef: string): number | null {
  const parts = Array.isArray(value) ? value : [value];
  if (parts.length < 1 || parts.length > 3) return null;
  const numbers = parts.map(rational);
  if (numbers.some((n) => n === null)) return null;
  const [deg = 0, min = 0, sec = 0] = numbers as number[];
  if (deg < 0 || min < 0 || min >= 60 || sec < 0 || sec >= 60) return null;
  let result = deg + min / 60 + sec / 3600;
  const ref = reference(refValue);
  if (ref === negativeRef) result = -result;
  else if (ref !== positiveRef) return null;
  return Number.isFinite(result) ? result : null;
}

/** Reads EXIF GPS only. Missing or malformed references never fall back to device location. */
export function exifGpsCoordinates(meta: ExifGps): Coordinate | undefined {
  if (!meta) return undefined;
  if (meta.GPSMapDatum !== undefined) {
    const datum = reference(meta.GPSMapDatum)?.replace(/[\s_-]/g, '');
    if (datum !== 'WGS84') return undefined;
  }
  const lat = degrees(meta.GPSLatitude, meta.GPSLatitudeRef, 'N', 'S');
  const lon = degrees(meta.GPSLongitude, meta.GPSLongitudeRef, 'E', 'W');
  if (lat === null || lon === null || Math.abs(lat) > 85 || Math.abs(lon) > 180)
    return undefined;
  const result: Coordinate = [lon, lat];
  return coordinate(result) ? result : undefined;
}

export function exifGpsAccuracy(meta: ExifGps): number | undefined {
  const value = rational(meta?.GPSHPositioningError);
  return value !== null && value >= 0 && value <= 100000 ? value : undefined;
}
