'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  gridPoints,
  normalizeWeather,
  weatherViewportGrid,
  type WeatherData,
  type WeatherGridBounds,
  type WeatherViewportGrid,
} from './data';

type WeatherRequestOptions = {
  /** Omit viewport for the ordinary anchor-centered weather request; null waits for map bounds. */
  viewport?: WeatherGridBounds | null;
  enabled?: boolean;
  variables?: 'all' | 'rain,showers';
};
type RequestPlan = { points: { lng: number; lat: number }[]; key: string; grid: WeatherViewportGrid | null; viewport: WeatherGridBounds | null; variables: string };
const VIEWPORT_CACHE_TTL = 30 * 60 * 1000;

function wrapLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180;
}

function continuousBounds([west, south, eastValue, north]: WeatherGridBounds): WeatherGridBounds {
  let east = eastValue;
  while (east < west) east += 360;
  if (east - west >= 360) {
    const center = (west + east) / 2;
    west = center - 180;
    east = center + 180;
  }
  return [west, Math.min(south, north), east, Math.max(south, north)];
}

function coversBounds(data: WeatherData | null, bounds: WeatherGridBounds, targetStep: [number, number]) {
  if (!data?.cells.length) return false;
  const longitudes = [...new Set(data.cells.map(cell => cell.lng))].sort((a, b) => a - b);
  const latitudes = [...new Set(data.cells.map(cell => cell.lat))].sort((a, b) => a - b);
  if (longitudes.length < 2 || latitudes.length < 2) return false;
  const lngStep = longitudes[1] - longitudes[0];
  const latStep = latitudes[1] - latitudes[0];
  const tolerance = 1e-6;
  return lngStep <= targetStep[0] + tolerance &&
    latStep <= targetStep[1] + tolerance &&
    bounds[0] >= longitudes[0] - tolerance &&
    bounds[2] <= longitudes.at(-1)! + tolerance &&
    bounds[1] >= latitudes[0] - tolerance &&
    bounds[3] <= latitudes.at(-1)! + tolerance;
}

function requestPlan(anchor: [number, number], options?: WeatherRequestOptions): RequestPlan | null {
  if (options?.enabled === false) return null;
  if (options && Object.hasOwn(options, 'viewport')) {
    if (!options.viewport) return null;
    const grid = weatherViewportGrid(options.viewport);
    if (!grid) return null;
    return { points: grid.points, key: grid.key, grid, viewport: continuousBounds(options.viewport), variables: options.variables ?? 'all' };
  }
  const points = gridPoints(anchor[0], anchor[1]);
  return { points, key: `anchor:${anchor[0]}:${anchor[1]}`, grid: null, viewport: null, variables: options?.variables ?? 'all' };
}

export function useWeather(anchor: [number, number], options?: WeatherRequestOptions) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const dataRef = useRef(data);
  dataRef.current = data;
  const viewportCache = useRef<{ data: WeatherData; key: string } | null>(null);
  const anchorRef = useRef(anchor);
  anchorRef.current = anchor;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const plan = requestPlan(anchor, options);
  const planRef = useRef(plan);
  planRef.current = plan;
  const viewportMode = !!options && Object.hasOwn(options, 'viewport');
  const enabled = options?.enabled !== false;
  const modeKey = !enabled ? 'disabled' : viewportMode
    ? plan?.key ?? (options?.viewport ? `viewport:invalid:${options.viewport.join(',')}` : 'viewport:waiting')
    : plan?.key ?? 'anchor:invalid';

  const refresh = useCallback(async () => {
    const currentOptions = optionsRef.current;
    if (currentOptions?.enabled === false) return;
    const currentPlan = requestPlan(anchorRef.current, currentOptions);
    if (!currentPlan) {
      if (currentOptions && Object.hasOwn(currentOptions, 'viewport') && currentOptions.viewport) {
        setLoading(false);
        setError('当前视野暂不支持降雨采样范围');
      }
      return;
    }
    active.current?.abort();
    const abort = new AbortController();
    active.current = abort;
    setLoading(true);
    setError('');
    const points = currentPlan.points;
    const variables = currentPlan.variables === 'rain,showers'
      ? 'rain,showers'
      : 'temperature_2m,relative_humidity_2m,rain,showers,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m,weather_code';
    const query = new URLSearchParams({
      latitude: points.map(p => p.lat).join(','),
      // Open-Meteo expects conventional wrapped longitudes; keep the original
      // continuous coordinates locally so raster meshes remain date-line safe.
      longitude: points.map(p => wrapLongitude(p.lng)).join(','),
      hourly: variables,
      forecast_hours: '25',
      timeformat: 'unixtime',
      timezone: 'GMT',
      ...(currentPlan.variables === 'all' ? { wind_speed_unit: 'ms' } : {}),
    });
    try {
      const response = await fetch(
        'https://api.open-meteo.com/v1/forecast?' + query,
        { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]) },
      );
      if (!response.ok)
        throw new Error(response.status === 429 ? '天气服务调用较多，请稍后再试' : '天气服务暂不可用');
      const result = normalizeWeather(await response.json(), points);
      if (!abort.signal.aborted) {
        setData(result);
        dataRef.current = result;
        if (currentPlan.grid) {
          viewportCache.current = { data: result, key: currentPlan.key };
        }
      }
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : '天气请求超时，请重试');
        setData(null);
        dataRef.current = null;
      }
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    active.current?.abort();
    active.current = null;
    if (!enabled) {
      setLoading(false);
      setError('');
      return;
    }
    if (viewportMode && !options?.viewport) {
      setData(null);
      dataRef.current = null;
      setLoading(true);
      setError('');
      return;
    }
    if (!plan) {
      setLoading(false);
      setError(viewportMode ? '当前视野暂不支持降雨采样范围' : '');
      if (viewportMode) {
        setData(null);
        dataRef.current = null;
      }
      return;
    }
    const cached = viewportCache.current;
    const cacheIsFresh = !!cached && Date.now() - cached.data.fetchedAt < VIEWPORT_CACHE_TTL;
    const reuseViewportData = viewportMode && !!plan.grid && !!plan.viewport && !!cached && cacheIsFresh && (
      cached.key === plan.key || coversBounds(cached.data, plan.viewport, plan.grid.step)
    );
    if (reuseViewportData) {
      setData(cached!.data);
      dataRef.current = cached!.data;
      setLoading(false);
      setError('');
      return;
    }
    setData(null);
    dataRef.current = null;
    setLoading(true);
    setError('');
    const delay = setTimeout(() => void refresh(), 450);
    return () => {
      clearTimeout(delay);
      active.current?.abort();
    };
  }, [modeKey, enabled, viewportMode, plan?.key, refresh]);

  useEffect(() => {
    if (!enabled || (viewportMode && !plan)) return;
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, viewportMode ? 30 * 60 * 1000 : 15 * 60 * 1000);
    return () => {
      clearInterval(interval);
      active.current?.abort();
    };
  }, [enabled, viewportMode, !!plan, refresh]);
  return { data, loading, error, refresh };
}
