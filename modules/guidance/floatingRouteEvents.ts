import type { Annotation } from '../annotations/data';
import { analyzeWeatherRoute, buildWeatherRoute, type WeatherRoute } from '../journey/routeWeatherAnalysis.ts';
import type { RouteForecast } from '../journey/weatherProvider.ts';
import { coordinate, type PlannedRoute, type RoutePlace } from '../navigation/types.ts';
import { project, type Path } from './geometry.ts';
import type { FloatingNavigationRouteEvent } from './floatingNavigation';

export type FloatingNavigationMark = Pick<Annotation, 'kind' | 'visible' | 'coordinates' | 'name'>;

const markerToleranceM = 40;
const chunkEdges = 128;
const hourMs = 3_600_000;
const forecastLifetimeMs = 2 * hourMs;

function labelOf(name: string, fallback: string) {
  return (name.replace(/[\s\u0000-\u001f\u007f-\u009f]+/g, ' ').trim() || fallback).slice(0, 80);
}

export function buildFloatingMarkerEvents(
  path: Path,
  stops: readonly RoutePlace[] | undefined,
  marks: readonly FloatingNavigationMark[],
): FloatingNavigationRouteEvent[] {
  const events: FloatingNavigationRouteEvent[] = [];
  let floor = 0;
  stops?.slice(1, -1).forEach((stop, index) => {
    if (!coordinate(stop.coordinates)) return;
    const hit = project(path, stop.coordinates, floor);
    if (hit.offset > markerToleranceM) return;
    floor = hit.distance;
    events.push({ kind: 'marker', distanceM: Math.round(hit.distance), label: labelOf(stop.name, `途经点 ${index + 1}`) });
  });

  const pins = marks.filter(mark => mark.kind === 'pin' && mark.visible && coordinate(mark.coordinates));
  if (!pins.length) return events;
  const chunks = [];
  for (let start = 0; start < path.points.length - 1; start += chunkEdges) {
    const points = path.points.slice(start, start + chunkEdges + 1);
    const longitude = points.map(([lng]) => lng);
    const latitude = points.map(([, lat]) => lat);
    chunks.push({
      path: { points, cumulative: path.cumulative.slice(start, start + points.length), length: path.length },
      minLng: Math.min(...longitude),
      maxLng: Math.max(...longitude),
      minLat: Math.min(...latitude),
      maxLat: Math.max(...latitude),
    });
  }
  for (const pin of pins) {
    const [lng, lat] = pin.coordinates;
    const marginLat = markerToleranceM / 110_000;
    const marginLng = marginLat / Math.cos(lat * Math.PI / 180);
    let closest = markerToleranceM;
    let distanceM: number | undefined;
    for (const chunk of chunks) {
      if (lat < chunk.minLat - marginLat || lat > chunk.maxLat + marginLat) continue;
      if (chunk.maxLng - chunk.minLng < 180 &&
          ![lng - 360, lng, lng + 360].some(value => value >= chunk.minLng - marginLng && value <= chunk.maxLng + marginLng)) continue;
      const hit = project(chunk.path, pin.coordinates);
      if (hit.offset <= closest && (distanceM === undefined || hit.offset < closest)) {
        closest = hit.offset;
        distanceM = Math.round(hit.distance);
      }
    }
    if (distanceM === undefined) continue;
    const label = labelOf(pin.name, '地点标记');
    if (events.some(event => event.label === label && Math.abs(event.distanceM - distanceM) <= 10)) continue;
    events.push({ kind: 'marker', distanceM, label });
  }
  return events.sort((first, second) => first.distanceM - second.distanceM);
}

export function buildFloatingWeatherRoute(coordinates: PlannedRoute['coordinates'], durationSeconds: number) {
  return buildWeatherRoute([{ coordinates, durationSeconds }]);
}

export function buildFloatingRainEvents(
  route: WeatherRoute,
  forecast: RouteForecast,
  progressM: number,
  now: number,
): FloatingNavigationRouteEvent[] {
  const validForecastUntil = forecast.fetchedAt + forecastLifetimeMs;
  if (validForecastUntil <= now || route.totalMeters <= 0 || route.durationSeconds <= 0) return [];
  const progress = Math.min(progressM, route.totalMeters);
  const departure = now - progress / route.totalMeters * route.durationSeconds * 1000;
  const events: FloatingNavigationRouteEvent[] = [];
  let previousWetEnd = -1;
  let activeEvent: FloatingNavigationRouteEvent | undefined;
  for (const piece of analyzeWeatherRoute(route, forecast, departure).segments) {
    if (piece.endMeters <= progress || !(piece.rain && piece.rain > 0)) continue;
    const forecastHour = forecast.points[piece.sampleIndex]?.find(hour => piece.arrival >= hour.time - hourMs && piece.arrival < hour.time);
    if (!(forecastHour?.liquidRain && forecastHour.liquidRain > 0)) continue;
    const validUntilMs = Math.min(validForecastUntil, forecastHour.time);
    if (validUntilMs <= now) continue;
    if (previousWetEnd === piece.startMeters && activeEvent) {
      previousWetEnd = piece.endMeters;
      continue;
    }
    activeEvent = { kind: 'rain', distanceM: Math.floor(Math.max(piece.startMeters, progress)), label: '前方有雨', validUntilMs };
    events.push(activeEvent);
    previousWetEnd = piece.endMeters;
  }
  return events;
}
