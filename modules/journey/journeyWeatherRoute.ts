import type { JourneyPlaybackModel } from '../sky/journeyPlayback';
import { buildWeatherRoute, type WeatherRoute } from './routeWeatherAnalysis';

export function buildJourneyWeatherLayout(model: JourneyPlaybackModel): WeatherRoute {
  return buildWeatherRoute(model.segments.map(segment => ({
    coordinates: segment.points.map(point => [...point.coordinates]),
    durationSeconds: segment.endDistanceM - segment.startDistanceM,
  })));
}

export function timeJourneyWeatherRoute(layout: WeatherRoute, durationSeconds: number): WeatherRoute {
  const ratio = layout.durationSeconds > 0 ? durationSeconds / layout.durationSeconds : 0;
  return {
    ...layout,
    durationSeconds,
    segments: layout.segments.map(segment => ({
      ...segment,
      startSeconds: segment.startSeconds * ratio,
      endSeconds: segment.endSeconds === layout.durationSeconds ? durationSeconds : segment.endSeconds * ratio,
    })),
  };
}
