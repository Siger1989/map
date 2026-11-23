import { useEffect, useMemo, useState } from 'react';
import type { JourneyPlaybackModel } from '../sky/journeyPlayback';
import { buildJourneyWeatherLayout, timeJourneyWeatherRoute } from './journeyWeatherRoute';
import type { WeatherRoute } from './routeWeatherAnalysis';
import { fetchRouteWeather, journeyForecastHours, journeyWeatherForArrival, type JourneyFrameWeather, type RouteForecast } from './weatherProvider';

type JourneyRain = {
  status: 'off' | 'loading' | 'ready' | 'historical' | 'unavailable';
  rainAt(elapsedSeconds: number): number | null;
  weatherAt(elapsedSeconds: number): JourneyFrameWeather;
  stale: boolean;
};

const noWeather: JourneyFrameWeather = { rainMm: null, snowCm: null, cloudCover: null };
const noWeatherData = () => noWeather;
const noRainData = (): null => null;
const hourMs = 3_600_000;

function hasWeather(weather: JourneyFrameWeather): boolean {
  return weather.rainMm !== null || weather.snowCm !== null || weather.cloudCover !== null;
}
const dayMs = 86_400_000;

export function useJourneyRain(
  model: JourneyPlaybackModel,
  start: number | null,
  end: number | null,
  enabled: boolean,
): JourneyRain {
  const layout = useMemo(() => buildJourneyWeatherLayout(model), [model]);
  const cutoff = useMemo(() => Math.floor(Date.now() / 60_000) * 60_000, [start, end, enabled]);
  const lastForecastTime = (Math.floor(cutoff / dayMs) + 7) * dayMs;
  const validInterval = start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && end > start;
  const historical = validInterval && end <= cutoff;
  const canFetch = enabled && layout.stops.length > 0 && validInterval && !historical && start < lastForecastTime;
  const hours = canFetch ? journeyForecastHours(Math.max(start, cutoff), Math.min(end, lastForecastTime - 1)) : null;
  const startHour = hours?.startHour;
  const endHour = hours?.endHour;
  const [request, setRequest] = useState<{
    layout: WeatherRoute; startHour: number; endHour: number; forecast: RouteForecast | null;
  } | null>(null);

  useEffect(() => {
    if (startHour === undefined || endHour === undefined) return;
    const controller = new AbortController();
    setRequest(previous => previous?.forecast ? previous : null);
    // Defer starting so a discarded mount can cancel before issuing a request.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      const forecast = await fetchRouteWeather(layout.stops, controller.signal, {
        journeySky: true,
        hours: { startHour, endHour },
      }).catch(() => null);
      if (!controller.signal.aborted) setRequest({ layout, startHour, endHour, forecast });
    });
    return () => controller.abort();
  }, [layout, startHour, endHour]);

  return useMemo<JourneyRain>(() => {
    if (!enabled) return { status: 'off', rainAt: noRainData, weatherAt: noWeatherData, stale: false };
    if (historical) return { status: 'historical', rainAt: noRainData, weatherAt: noWeatherData, stale: false };
    if (!canFetch) return { status: 'unavailable', rainAt: noRainData, weatherAt: noWeatherData, stale: false };
    if (request?.layout !== layout || request.startHour !== startHour || request.endHour !== endHour) {
      return { status: 'loading', rainAt: noRainData, weatherAt: noWeatherData, stale: false };
    }
    const { forecast } = request;
    if (!forecast) return { status: 'unavailable', rainAt: noRainData, weatherAt: noWeatherData, stale: false };

    const route = timeJourneyWeatherRoute(layout, (end - start) / 1000);
    const weatherAt = (elapsedSeconds: number): JourneyFrameWeather => {
      if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0 || elapsedSeconds > route.durationSeconds) return noWeather;
      const arrival = elapsedSeconds === route.durationSeconds ? end : start + elapsedSeconds * 1000;
      if (arrival < cutoff || arrival >= lastForecastTime) return noWeather;
      // At a shared boundary, playback still draws the preceding segment.
      const segment = route.segments.find(piece => elapsedSeconds <= piece.endSeconds);
      if (!segment || elapsedSeconds < segment.startSeconds) return noWeather;
      if (elapsedSeconds === 0 && model.segments[0]?.endDistanceM === 0) return noWeather;
      return journeyWeatherForArrival(forecast.points[segment.sampleIndex], arrival);
    };
    const hasCoverage = route.segments.some(segment => {
      const from = Math.max(cutoff, start + segment.startSeconds * 1000);
      const until = Math.min(lastForecastTime, start + segment.endSeconds * 1000);
      if (hasWeather(weatherAt(segment.endSeconds))) return true;
      if (from >= until) return false;
      const hours = forecast.points[segment.sampleIndex];
      if (hasWeather(journeyWeatherForArrival(hours, from))) return true;
      return hours?.some(hour =>
        (hour.time > from && hour.time < until && hour.cloudCover != null) ||
        (hour.time > from && hour.time - hourMs < until &&
          (hour.liquidRain != null || hour.snowfall != null))
      );
    }) || hasWeather(weatherAt(route.durationSeconds));
    return {
      status: hasCoverage ? 'ready' : 'unavailable',
      rainAt: elapsedSeconds => weatherAt(elapsedSeconds).rainMm,
      weatherAt,
      stale: forecast.stale === true,
    };
  }, [enabled, historical, canFetch, request, layout, start, end, cutoff, lastForecastTime, model, startHour, endHour]);
}
