/** Optional, version-1-compatible photo details. Image edits never alter the source file. */
export type PhotoAltitude = {
  metres: number;
  source: 'exif' | 'track' | 'interpolated';
};
export type PhotoStroke = {
  color: '#ff625c' | '#ffda63' | '#ffffff';
  points: [number, number][];
};
export type PhotoEdits = {
  title?: string;
  note?: string;
  rotation?: number;
  strokes?: PhotoStroke[];
};
export type PhotoWeather = {
  source: 'era5' | 'forecast';
  time: number;
  fetchedAt: number;
  temperature: number | null;
  precipitation: number | null;
  wind: number | null;
  code: number | null;
};
export type PhotoDetails = PhotoEdits & {
  detail?: Blob;
  altitude?: PhotoAltitude;
  weather?: PhotoWeather;
  weatherError?: string;
};
export function validAltitude(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= -12000 &&
    value <= 100000
  );
}
export function exifAltitude(
  meta?: Record<string, unknown>,
): PhotoAltitude | undefined {
  const value = meta?.GPSAltitude,
    rawRef = meta?.GPSAltitudeRef,
    ref =
      rawRef instanceof Uint8Array && rawRef.length === 1 ? rawRef[0] : rawRef;
  if (!validAltitude(value) || (ref !== 0 && ref !== 1)) return undefined;
  return { metres: (ref === 1 ? -1 : 1) * Math.abs(value), source: 'exif' };
}
export function altitudeLabel(altitude?: PhotoAltitude) {
  if (!altitude) return '海拔未记录';
  return `海拔 ${altitude.metres.toFixed(0)} m · ${{ exif: '照片EXIF', track: '轨迹记录', interpolated: '轨迹插值估算' }[altitude.source]}`;
}
export function weatherSource(weather: PhotoWeather) {
  return weather.source === 'era5'
    ? 'Open-Meteo / ERA5 历史再分析'
    : 'Open-Meteo 近期模型天气';
}
export function validDetails(p: PhotoDetails) {
  return (
    (p.detail === undefined ||
      (p.detail instanceof Blob &&
        p.detail.type === 'image/jpeg' &&
        p.detail.size <= 4 * 1024 * 1024)) &&
    (p.altitude === undefined ||
      (p.altitude &&
        validAltitude(p.altitude.metres) &&
        ['exif', 'track', 'interpolated'].includes(p.altitude.source))) &&
    (p.title === undefined ||
      (typeof p.title === 'string' && p.title.length <= 100)) &&
    (p.note === undefined ||
      (typeof p.note === 'string' && p.note.length <= 1000)) &&
    (p.rotation === undefined || [0, 90, 180, 270].includes(p.rotation)) &&
    (p.strokes === undefined ||
      (Array.isArray(p.strokes) &&
        p.strokes.length <= 80 &&
        p.strokes.every(
          (s) =>
            s &&
            ['#ff625c', '#ffda63', '#ffffff'].includes(s.color) &&
            Array.isArray(s.points) &&
            s.points.length >= 1 &&
            s.points.length <= 400 &&
            s.points.every(
              (v) =>
                Array.isArray(v) &&
                v.length === 2 &&
                v.every(
                  (n) =>
                    typeof n === 'number' &&
                    Number.isFinite(n) &&
                    n >= 0 &&
                    n <= 1,
                ),
            ),
        ))) &&
    (p.weatherError === undefined ||
      (typeof p.weatherError === 'string' && p.weatherError.length <= 200)) &&
    (p.weather === undefined ||
      (!!p.weather &&
        ['era5', 'forecast'].includes(p.weather.source) &&
        Number.isFinite(p.weather.time) &&
        Number.isFinite(p.weather.fetchedAt) &&
        ['temperature', 'precipitation', 'wind', 'code'].every((k) => {
          const v = p.weather![k as 'temperature'];
          return v === null || (typeof v === 'number' && Number.isFinite(v));
        })))
  );
}
