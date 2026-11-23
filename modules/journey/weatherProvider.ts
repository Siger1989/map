import type { JourneySample } from './metrics';
export type RouteHour = {
  time: number;
  temperature: number | null;
  precipitation: number | null;
  liquidRain?: number | null;
  snowfall?: number | null;
  cloudCover?: number | null;
  wind: number | null;
  code: number | null;
};
export type JourneyFrameWeather = {
  rainMm: number | null;
  snowCm: number | null;
  cloudCover: number | null;
};

export type RouteForecast = {
  fetchedAt: number;
  stale?: boolean;
  points: RouteHour[][];
};
const cache = new Map<string, RouteForecast>();
const hourMs = 3_600_000;
const freshForecastMs = 15 * 60_000;

export function journeyForecastHours(start: number, end: number) {
  return {
    startHour: Math.floor(start / hourMs) * hourMs,
    // A frame at an exact hour still needs the following hour's precipitation total.
    endHour: (Math.floor(end / hourMs) + 1) * hourMs,
  };
}

type ForecastHours = ReturnType<typeof journeyForecastHours>;

function coversHours(forecast: RouteForecast, count: number, hours: ForecastHours) {
  return forecast.points.length === count && forecast.points.every(point =>
    point.length && point[0].time <= hours.startHour && point.at(-1)!.time >= hours.endHour,
  );
}

class ForecastHttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(status === 429 ? '天气服务请求较多，请稍后重试。' : `沿途天气暂不可用（${status}）`);
    this.status = status;
  }
}

async function requestForecast(query: URLSearchParams, signal: AbortSignal, shortWindow: boolean) {
  const deadlines = shortWindow ? [5_000, 7_000] : [25_000];
  for (const [attempt, deadline] of deadlines.entries()) {
    signal.throwIfAborted();
    const timeout = AbortSignal.timeout(deadline);
    try {
      const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, {
        signal: AbortSignal.any([signal, timeout]),
      });
      if (!response.ok) throw new ForecastHttpError(response.status);
      return await response.json();
    } catch (error) {
      signal.throwIfAborted();
      const retryable = timeout.aborted || error instanceof TypeError ||
        (error instanceof ForecastHttpError && error.status >= 500);
      if (!retryable || attempt === deadlines.length - 1) throw error;
    }
  }
}

export function parseForecast(payload: unknown, count: number, liquidRain = false, journeySky = false): RouteHour[][] {
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
      .flatMap((time: unknown, i: number) => {
        if (typeof time !== 'number' || !Number.isFinite(time)) return [];
        const hour: RouteHour = {
          time: time * 1000,
          temperature: value('temperature_2m', i),
          precipitation: value('precipitation', i),
          wind: value('wind_speed_10m', i),
          code: value('weather_code', i),
        };
        if (liquidRain || journeySky) {
          const rain = value('rain', i), showers = value('showers', i);
          hour.liquidRain = rain !== null && showers !== null && rain >= 0 && showers >= 0
            ? Math.round((rain + showers) * 1000) / 1000
            : hour.precipitation === 0 ? 0 : null;
        }
        if (journeySky) {
          const snowfall = value('snowfall', i);
          const cloudCover = value('cloud_cover', i);
          hour.snowfall = snowfall !== null && snowfall >= 0 ? snowfall : null;
          hour.cloudCover = cloudCover !== null && cloudCover >= 0 && cloudCover <= 100 ? cloudCover : null;
        }
        return [hour];
      })
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
export function journeyWeatherForArrival(hours: RouteHour[] | undefined, arrival: number): JourneyFrameWeather {
  if (!hours?.length || !Number.isFinite(arrival)) return { rainMm: null, snowCm: null, cloudCover: null };
  // Rain and snowfall totals end at the supplied timestamp. Cloud cover is instantaneous.
  const nextIndex = hours.findIndex(hour => hour.time > arrival);
  const next = hours[nextIndex];
  const previous = nextIndex === -1 ? hours.at(-1) : hours[nextIndex - 1];
  const accumulation = next && arrival >= next.time - hourMs ? next : undefined;
  let cloudCover: number | null = null;
  if (previous?.time === arrival) {
    cloudCover = previous.cloudCover ?? null;
  } else if (previous?.cloudCover != null && next?.cloudCover != null && next.time - previous.time === hourMs) {
    const fraction = (arrival - previous.time) / hourMs;
    cloudCover = previous.cloudCover + (next.cloudCover - previous.cloudCover) * fraction;
  }
  return {
    rainMm: accumulation?.liquidRain ?? null,
    snowCm: accumulation?.snowfall ?? null,
    cloudCover,
  };
}

export async function fetchRouteWeather(
  stops: JourneySample[],
  signal: AbortSignal,
  { liquidRain = false, journeySky = false, refresh = false, hours }: {
    liquidRain?: boolean; journeySky?: boolean; refresh?: boolean; hours?: ForecastHours;
  } = {},
): Promise<RouteForecast> {
  signal.throwIfAborted();
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
  const requestedHours = journeySky ? hours : undefined;
  const routeKey = (journeySky ? 'journey-sky:' : liquidRain ? 'rain:' : '') + stops.map((s) => s.coordinates.join(',')).join(';');
  const key = requestedHours ? `${routeKey}|${requestedHours.startHour}:${requestedHours.endHour}` : routeKey;
  let cached = cache.get(key);
  if (requestedHours) {
    // Reuse overlapping runs and existing whole-week caches only when they cover the new window.
    for (const [storedKey, candidate] of cache) {
      if ((storedKey === routeKey || storedKey.startsWith(`${routeKey}|`)) &&
        (!cached || candidate.fetchedAt > cached.fetchedAt) && coversHours(candidate, stops.length, requestedHours)) {
        cached = candidate;
      }
    }
  }
  if (!refresh && cached && Date.now() - cached.fetchedAt < freshForecastMs) return cached;
  const query = new URLSearchParams({
    latitude: stops.map((s) => s.coordinates[1].toFixed(5)).join(','),
    longitude: stops.map((s) => s.coordinates[0].toFixed(5)).join(','),
    hourly: journeySky ? 'rain,showers,precipitation,snowfall,cloud_cover' : liquidRain ? 'rain,showers,precipitation' : 'temperature_2m,precipitation,wind_speed_10m,weather_code',
    timeformat: 'unixtime',
    timezone: 'GMT',
    wind_speed_unit: 'ms',
  });
  if (requestedHours) {
    query.set('start_hour', new Date(requestedHours.startHour).toISOString().slice(0, 16));
    query.set('end_hour', new Date(requestedHours.endHour).toISOString().slice(0, 16));
  } else {
    query.set('forecast_days', '7');
  }
  try {
    const payload = await requestForecast(query, signal, !!requestedHours);
    signal.throwIfAborted();
    const points = parseForecast(payload, stops.length, liquidRain, journeySky);
    if (requestedHours && !points.some(point => point.some(hour =>
      hour.time >= requestedHours.startHour && hour.time <= requestedHours.endHour,
    ))) {
      throw new Error('天气服务未返回所选行程时段。');
    }
    const result = {
      fetchedAt: Date.now(),
      points,
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
