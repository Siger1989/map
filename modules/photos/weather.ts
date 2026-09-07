import type { Coordinate } from '../navigation/types.ts';
import type { PhotoWeather } from './details.ts';
const HOUR = 3600000,
  DAY = 24 * HOUR;
export function photoWeatherRequest(
  time: number,
  coordinates: Coordinate,
  now = Date.now(),
) {
  if (
    !Number.isFinite(time) ||
    time > now + 300000 ||
    time < Date.UTC(1940, 0, 1)
  )
    throw new Error('拍摄时间超出可查询范围，请检查照片时间');
  const source = now - time > 7 * DAY ? 'era5' : 'forecast';
  const hour = Math.round(time / HOUR) * HOUR,
    day = new Date(hour).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    latitude: coordinates[1].toFixed(5),
    longitude: coordinates[0].toFixed(5),
    start_date: day,
    end_date: day,
    hourly: 'temperature_2m,precipitation,wind_speed_10m,weather_code',
    timezone: 'GMT',
    timeformat: 'unixtime',
    wind_speed_unit: 'ms',
    temperature_unit: 'celsius',
    precipitation_unit: 'mm',
  });
  if (source === 'era5') q.set('models', 'era5');
  return {
    source,
    hour,
    url: `https://${source === 'era5' ? 'archive-api.open-meteo.com/v1/archive' : 'api.open-meteo.com/v1/forecast'}?${q}`,
  } as const;
}
export function parsePhotoWeather(
  payload: unknown,
  hour: number,
  source: PhotoWeather['source'],
  now = Date.now(),
): PhotoWeather {
  const h = (payload as { hourly?: Record<string, unknown> })?.hourly;
  const i = Array.isArray(h?.time) ? h.time.indexOf(hour / 1000) : -1;
  if (!h || i < 0) throw new Error('该拍摄时次的天气尚不可用');
  const value = (key: string) => {
    const v = Array.isArray(h[key]) ? h[key][i] : null;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  const w: PhotoWeather = {
    source,
    time: hour,
    fetchedAt: now,
    temperature: value('temperature_2m'),
    precipitation: value('precipitation'),
    wind: value('wind_speed_10m'),
    code: value('weather_code'),
  };
  if ([w.temperature, w.precipitation, w.wind, w.code].every((v) => v === null))
    throw new Error('该拍摄时次没有有效天气数据');
  return w;
}
const cache = new Map<string, { payload: unknown; fetchedAt: number }>();
export async function fetchPhotoWeather(
  time: number,
  coordinates: Coordinate,
  signal: AbortSignal,
) {
  const request = photoWeatherRequest(time, coordinates);
  let cached = cache.get(request.url);
  if (!cached || Date.now() - cached.fetchedAt > 15 * 60000) {
    const r = await fetch(request.url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    });
    if (!r.ok)
      throw new Error(
        r.status === 429
          ? '天气请求较多，请稍后重试'
          : '拍摄天气暂不可用，可稍后重试',
      );
    cached = { payload: await r.json(), fetchedAt: Date.now() };
  }
  const weather = parsePhotoWeather(
    cached.payload,
    request.hour,
    request.source,
    cached.fetchedAt,
  );
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(request.url, cached);
  return weather;
}
