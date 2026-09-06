import type { JourneySample } from './metrics';
export type RouteHour = {
  time: number;
  temperature: number | null;
  precipitation: number | null;
  wind: number | null;
  code: number | null;
};
export type RouteForecast = {
  fetchedAt: number;
  stale?: boolean;
  points: RouteHour[][];
};
const cache = new Map<string, RouteForecast>();
export function parseForecast(payload: unknown, count: number): RouteHour[][] {
  const records = Array.isArray(payload) ? payload : [payload];
  if (records.length !== count)
    throw new Error('沿途天气返回的地点数不一致，请重试。');
  return records.map((record) => {
    const h = record?.hourly;
    if (!h || !Array.isArray(h.time)) throw new Error('沿途天气数据格式异常。');
    const value = (key: string, i: number) =>
      typeof h[key]?.[i] === 'number' && Number.isFinite(h[key][i])
        ? (h[key][i] as number)
        : null;
    return h.time
      .flatMap((time: unknown, i: number) =>
        typeof time !== 'number' || !Number.isFinite(time)
          ? []
          : [
              {
                time: time * 1000,
                temperature: value('temperature_2m', i),
                precipitation: value('precipitation', i),
                wind: value('wind_speed_10m', i),
                code: value('weather_code', i),
              },
            ],
      )
      .sort((a: RouteHour, b: RouteHour) => a.time - b.time);
  });
}
export function matchForecast(
  hours: RouteHour[] | undefined,
  arrival: number,
): RouteHour | null {
  // Nearest hourly forecast. Precipitation is the preceding hour at that timestamp.
  if (
    !Number.isFinite(arrival) ||
    !hours?.length ||
    arrival < hours[0].time ||
    arrival > hours.at(-1)!.time
  )
    return null;
  const nearest = hours.reduce((a, b) =>
    Math.abs(b.time - arrival) < Math.abs(a.time - arrival) ? b : a,
  );
  return Math.abs(nearest.time - arrival) <= 1800000 ? nearest : null;
}
export async function fetchRouteWeather(
  stops: JourneySample[],
  signal: AbortSignal,
): Promise<RouteForecast> {
  try {
    if (!cache.size && typeof localStorage !== 'undefined') {
      const stored = JSON.parse(
        localStorage.getItem('guanyun.route-weather.v1') ?? '[]',
      );
      for (const [key, value] of stored.slice(0, 8))
        if (
          typeof key === 'string' &&
          Number.isFinite(value?.fetchedAt) &&
          Array.isArray(value.points) &&
          value.points.every(
            (p: unknown) =>
              Array.isArray(p) && p.every((h) => h && Number.isFinite(h.time)),
          )
        )
          cache.set(key, value);
    }
  } catch {}
  const key = stops.map((s) => s.coordinates.join(',')).join(';'),
    cached = cache.get(key);
  if (cached && Date.now() - cached.fetchedAt < 15 * 60000) return cached;
  const query = new URLSearchParams({
    latitude: stops.map((s) => s.coordinates[1].toFixed(5)).join(','),
    longitude: stops.map((s) => s.coordinates[0].toFixed(5)).join(','),
    hourly: 'temperature_2m,precipitation,wind_speed_10m,weather_code',
    forecast_days: '7',
    timeformat: 'unixtime',
    timezone: 'GMT',
    wind_speed_unit: 'ms',
  });
  try {
    const response = await fetch(
      `https://api.open-meteo.com/v1/forecast?${query}`,
      { signal: AbortSignal.any([signal, AbortSignal.timeout(25000)]) },
    );
    if (!response.ok)
      throw new Error(
        response.status === 429
          ? '天气服务请求较多，请稍后重试。'
          : `沿途天气暂不可用（${response.status}）`,
      );
    const result = {
      fetchedAt: Date.now(),
      points: parseForecast(await response.json(), stops.length),
    };
    if (cache.size >= 12) cache.delete(cache.keys().next().value!);
    cache.set(key, result);
    try {
      if (typeof localStorage !== 'undefined')
        localStorage.setItem(
          'guanyun.route-weather.v1',
          JSON.stringify([...cache.entries()].slice(-8)),
        );
    } catch {}
    return result;
  } catch (e) {
    if (cached && !signal.aborted) return { ...cached, stale: true };
    throw e;
  }
}
