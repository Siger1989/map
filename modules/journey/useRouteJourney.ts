import { useEffect, useMemo, useState } from 'react';
import type { PlannedRoute } from '../navigation/types';
import {
  fetchRouteWeather,
  matchForecast,
  type RouteForecast,
} from './weatherProvider';
import { routeWeatherStops } from './routeProgress';
export const beijingInput = (time = Date.now()) =>
  new Date(time + 8 * 3600000).toISOString().slice(0, 16);
export const beijingTime = (time: number) =>
  new Date(time).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
export function useRouteJourney(route: PlannedRoute | null) {
  const stops = useMemo(() => (route ? routeWeatherStops(route) : []), [route]);
  const [departure, setDeparture] = useState(() => beijingInput()),
    [response, setResponse] = useState<{
      stops: typeof stops;
      data: RouteForecast;
    } | null>(null);
  const forecast = response?.stops === stops ? response.data : null;
  const [loading, setLoading] = useState(false),
    [error, setError] = useState(''),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    setDeparture(beijingInput());
  }, [route]);
  useEffect(() => {
    setResponse(null);
    setError('');
    if (!stops.length) {
      setLoading(false);
      return;
    }
    const request = new AbortController();
    setLoading(true);
    void fetchRouteWeather(stops, request.signal)
      .then((value) => {
        if (!request.signal.aborted) setResponse({ stops, data: value });
      })
      .catch((e) => {
        if (!request.signal.aborted)
          setError(e instanceof Error ? e.message : '沿途天气读取失败');
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [stops, retry]);
  const departureTime = new Date(departure + '+08:00').getTime();
  const entries = useMemo(
    () =>
      stops.map((stop, i) => ({
        ...stop,
        arrival: departureTime + stop.seconds * 1000,
        weather:
          forecast && Number.isFinite(departureTime)
            ? matchForecast(
                forecast.points[i],
                departureTime + stop.seconds * 1000,
              )
            : null,
      })),
    [stops, forecast, departureTime],
  );
  const alternatives = [-2, 0, 2].map((offset) => {
    const time = departureTime + offset * 3600000;
    const hours = stops.map((stop, i) =>
      forecast
        ? matchForecast(forecast.points[i], time + stop.seconds * 1000)
        : null,
    );
    const complete =
      hours.length > 0 &&
      hours.every((h) => h && h.precipitation !== null && h.wind !== null);
    return {
      offset,
      time,
      complete,
      rain: complete ? Math.max(...hours.map((h) => h!.precipitation!)) : null,
      wind: complete ? Math.max(...hours.map((h) => h!.wind!)) : null,
    };
  });
  return {
    alternatives,
    departure,
    setDeparture,
    entries,
    forecast,
    loading,
    error,
    retry: () => setRetry((n) => n + 1),
    validTime: Number.isFinite(departureTime),
  };
}
export type RouteJourneyState = ReturnType<typeof useRouteJourney>;
