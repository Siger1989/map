import {
  coordinate,
  metresBetween,
  type Coordinate,
} from '../navigation/types.ts';
import { pointAlong, type JourneySample } from './metrics.ts';
import type { RouteForecast, RouteHour } from './weatherProvider.ts';

const TARGET_METERS = 1500;
const MAX_SAMPLES = 10;
const HOUR_MS = 3600000;
const FORECAST_HOURS = 7 * 24;
const MAX_DATE_MS = 8640000000000000;

export const hourlyRainBands = [
  { kind: 'dry', label: '无雨', below: 0 },
  { kind: 'trace', label: '＜0.2', below: 0.2 },
  { kind: 'light', label: '0.2–＜0.5', below: 0.5 },
  { kind: 'moderate', label: '0.5–＜2', below: 2 },
  { kind: 'heavy', label: '2–＜5', below: 5 },
  { kind: 'intense', label: '≥5', below: Infinity },
  { kind: 'unknown', label: '暂无数据', below: null },
] as const;

export function hourlyRainBand(rain: number | null) {
  if (rain === null || !Number.isFinite(rain) || rain < 0) return 'unknown';
  if (rain === 0) return 'dry';
  return hourlyRainBands.find(band => band.below !== null && rain < band.below)?.kind ?? 'unknown';
}

type RoutePart = {
  coordinates: Coordinate[];
  startMeters: number;
  endMeters: number;
  startSeconds: number;
  endSeconds: number;
};
type WeatherSegment = RoutePart & { sampleIndex: number };

export type WeatherRoute = {
  segments: WeatherSegment[];
  stops: JourneySample[];
  totalMeters: number;
  durationSeconds: number;
};

export type WeatherRouteResult = {
  departure: number;
  segments: (WeatherSegment & { rain: number | null; arrival: number })[];
  maxRain: number | null;
  wetMeters: number;
  unknownMeters: number;
};

function connectedLines(coordinates: Coordinate[]) {
  const lines: { coordinates: Coordinate[]; length: number }[] = [];
  let line = { coordinates: [] as Coordinate[], length: 0 };
  for (const point of coordinates) {
    if (!coordinate(point)) {
      line = { coordinates: [], length: 0 };
      continue;
    }
    const last = line.coordinates.at(-1);
    if (!last) {
      line.coordinates.push(point);
      continue;
    }
    const distance = metresBetween(last, point);
    if (!(distance > 0)) continue;
    if (line.coordinates.length === 1) lines.push(line);
    line.coordinates.push(point);
    line.length += distance;
  }
  return lines;
}

function splitPart(part: RoutePart, cuts: number[]): RoutePart[] {
  if (cuts.length === 0) return [part];
  const pieces: RoutePart[] = [];
  const { coordinates, startMeters, endMeters, startSeconds, endSeconds } =
    part;
  const length = endMeters - startMeters;
  let previousCut = coordinates[0];
  let nextVertex = 1;
  let edgeStart = 0;
  let edgeEnd = metresBetween(coordinates[0], coordinates[1]);
  const boundaries = [0, ...cuts, 1];
  for (let index = 1; index < boundaries.length; index++) {
    const from = boundaries[index - 1];
    const to = boundaries[index];
    const cutDistance = length * to;
    const line = [previousCut];
    while (nextVertex < coordinates.length && edgeEnd < cutDistance) {
      line.push(coordinates[nextVertex]);
      edgeStart = edgeEnd;
      nextVertex++;
      if (nextVertex < coordinates.length) {
        edgeEnd += metresBetween(
          coordinates[nextVertex - 1],
          coordinates[nextVertex],
        );
      }
    }
    const cut =
      to === 1 || nextVertex === coordinates.length
        ? coordinates.at(-1)!
        : cutDistance === edgeEnd
          ? coordinates[nextVertex]
          : pointAlong(
              coordinates.slice(nextVertex - 1, nextVertex + 1),
              cutDistance - edgeStart,
            );
    if (line.at(-1) !== cut) line.push(cut);
    // At an existing vertex, the next piece already starts at that same point.
    if (cut === coordinates[nextVertex]) {
      edgeStart = edgeEnd;
      nextVertex++;
      if (nextVertex < coordinates.length) {
        edgeEnd += metresBetween(
          coordinates[nextVertex - 1],
          coordinates[nextVertex],
        );
      }
    }
    pieces.push({
      coordinates: line,
      startMeters: startMeters + length * from,
      endMeters: to === 1 ? endMeters : startMeters + length * to,
      startSeconds: startSeconds + (endSeconds - startSeconds) * from,
      endSeconds:
        to === 1 ? endSeconds : startSeconds + (endSeconds - startSeconds) * to,
    });
    previousCut = cut;
  }
  return pieces;
}

export function buildWeatherRoute(
  segments: { coordinates: Coordinate[]; durationSeconds: number }[],
): WeatherRoute {
  const parts: RoutePart[] = [];
  let totalMeters = 0;
  let durationSeconds = 0;
  for (const segment of segments) {
    const lines = connectedLines(segment.coordinates);
    const segmentMeters = lines.reduce((sum, line) => sum + line.length, 0);
    const duration = Number.isFinite(segment.durationSeconds)
      ? Math.max(0, segment.durationSeconds)
      : 0;
    let elapsed = 0;
    for (const line of lines) {
      const lineDuration = duration * (line.length / segmentMeters);
      parts.push({
        coordinates: line.coordinates,
        startMeters: totalMeters,
        endMeters: totalMeters + line.length,
        startSeconds: durationSeconds + elapsed,
        endSeconds: durationSeconds + elapsed + lineDuration,
      });
      totalMeters += line.length;
      elapsed += lineDuration;
    }
    durationSeconds += duration;
  }
  const counts = parts.map(() => 1);
  for (let remaining = MAX_SAMPLES - parts.length; remaining > 0; remaining--) {
    let longestPart = -1;
    let longestPiece = TARGET_METERS;
    for (const [index, part] of parts.entries()) {
      const pieceLength = (part.endMeters - part.startMeters) / counts[index];
      if (pieceLength > longestPiece) {
        longestPiece = pieceLength;
        longestPart = index;
      }
    }
    if (longestPart < 0) break;
    counts[longestPart]++;
  }

  const stops: JourneySample[] = [];
  const sampledParts = new Set(
    parts
      .map((part, index) => ({
        index,
        length: part.endMeters - part.startMeters,
      }))
      .sort((a, b) => b.length - a.length)
      .slice(0, MAX_SAMPLES)
      .map(({ index }) => index),
  );
  const weatherSegments = parts.flatMap((part, index) =>
    splitPart(
      part,
      Array.from(
        { length: counts[index] - 1 },
        (_, cut) => (cut + 1) / counts[index],
      ),
    ).map((piece): WeatherSegment => {
      let sampleIndex = -1;
      if (sampledParts.has(index)) {
        sampleIndex = stops.length;
        const halfway = (piece.endMeters - piece.startMeters) / 2;
        stops.push({
          coordinates: pointAlong(piece.coordinates, halfway),
          distance: piece.startMeters + halfway,
          part: index,
        });
      }
      return { ...piece, sampleIndex };
    }),
  );
  return { segments: weatherSegments, stops, totalMeters, durationSeconds };
}

export function rainForArrival(hours: RouteHour[] | undefined, arrival: number): number | null {
  // Open-Meteo timestamps mark the end of the accumulation window.
  const hour = hours?.find(({ time }) => arrival >= time - HOUR_MS && arrival < time);
  const rain = hour?.liquidRain === undefined ? hour?.precipitation : hour.liquidRain;
  return typeof rain === 'number' && Number.isFinite(rain) && rain >= 0 ? rain : null;
}

export function analyzeWeatherRoute(
  route: WeatherRoute,
  forecast: RouteForecast | null,
  departure: number,
): WeatherRouteResult {
  let maxRain: number | null = null;
  let wetMeters = 0;
  let unknownMeters = 0;
  const finalHour =
    Math.floor(departure / HOUR_MS) * HOUR_MS + FORECAST_HOURS * HOUR_MS;
  const segments = route.segments.flatMap((segment) => {
    const hours = forecast?.points[segment.sampleIndex];
    const start = departure + segment.startSeconds * 1000;
    const end = departure + segment.endSeconds * 1000;
    const hourCuts: number[] = [];
    if (
      hours?.length &&
      Math.abs(start) <= MAX_DATE_MS &&
      Number.isFinite(end)
    ) {
      const firstBoundary = (Math.floor(start / HOUR_MS) + 1) * HOUR_MS;
      for (
        let boundary = firstBoundary;
        boundary < end && boundary <= finalHour;
        boundary += HOUR_MS
      ) {
        hourCuts.push((boundary - start) / (end - start));
      }
    }
    return splitPart(segment, hourCuts).map((piece) => {
      const arrival = departure + (piece.startSeconds + piece.endSeconds) * 500;
      const rain = arrival < finalHour ? rainForArrival(hours, arrival) : null;
      const length = piece.endMeters - piece.startMeters;
      if (rain === null) {
        unknownMeters += length;
      } else {
        maxRain = Math.max(maxRain ?? 0, rain);
        if (rain > 0) wetMeters += length;
      }
      return { ...piece, sampleIndex: segment.sampleIndex, rain, arrival };
    });
  });
  return { departure, segments, maxRain, wetMeters, unknownMeters };
}
