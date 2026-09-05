'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { gridPoints, normalizeWeather, type WeatherData } from './data';
export function useWeather(anchor: [number, number]) {
  const [data, setData] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  const latestAnchor = useRef(anchor);
  latestAnchor.current = anchor;
  const refresh = useCallback(async () => {
    active.current?.abort();
    const abort = new AbortController();
    active.current = abort;
    setLoading(true);
    setError('');
    const [lng, lat] = latestAnchor.current;
    const points = gridPoints(lng, lat);
    const query = new URLSearchParams({
      latitude: points.map((p) => p.lat).join(','),
      longitude: points.map((p) => p.lng).join(','),
      hourly:
        'temperature_2m,relative_humidity_2m,rain,cloud_cover_low,cloud_cover_mid,cloud_cover_high,wind_speed_10m,wind_direction_10m,weather_code',
      forecast_hours: '25',
      timeformat: 'unixtime',
      timezone: 'GMT',
      wind_speed_unit: 'ms',
    });
    try {
      const response = await fetch(
        'https://api.open-meteo.com/v1/forecast?' + query,
        { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(25000)]) },
      );
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? '天气服务调用较多，请稍后再试'
            : '天气服务暂不可用',
        );
      const result = normalizeWeather(await response.json(), points);
      if (!abort.signal.aborted) setData(result);
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(
          e instanceof Error && e.name !== 'TimeoutError'
            ? e.message
            : '天气请求超时，请重试',
        );
        setData(null);
      }
    } finally {
      if (!abort.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setData(null);
    const delay = setTimeout(refresh, 450);
    return () => {
      clearTimeout(delay);
      active.current?.abort();
    };
  }, [anchor[0], anchor[1], refresh]);
  useEffect(() => {
    const interval = setInterval(
      () => {
        if (!document.hidden) void refresh();
      },
      15 * 60 * 1000,
    );
    return () => {
      clearInterval(interval);
      active.current?.abort();
    };
  }, [refresh]);
  return { data, loading, error, refresh };
}
