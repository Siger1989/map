'use client';

import { useEffect, useMemo, useState } from 'react';
import { WeatherRegionStore } from './weatherRegionStore.ts';

export type WeatherBounds = readonly [west: number, south: number, east: number, north: number];

export type WeatherRegion = {
  id: string;
  bounds: WeatherBounds;
  center: readonly [longitude: number, latitude: number];
};

export type CurrentWeather = {
  rainMm: number | null;
  snowCm: number | null;
  cloudCover: number | null;
  isDay?: boolean;
  time: number;
  interval: number;
};

const mercatorLatitudeLimit = 85.05112878;
const maxViewportSpan = 60;
const maxRegions = 32;
const regionSteps = [0.03125, 0.0625, 0.125, 0.25, 0.5, 1, 2, 4, 8, 16];

/** Keep cell bounds in the map's world copy and request coordinates in the canonical world. */
export function planWeatherRegions(bounds: WeatherBounds): WeatherRegion[] {
  const [west, south, east, north] = bounds;
  if (!bounds.every(Number.isFinite) || north <= south || west === east) return [];

  const rawSpan = east - west;
  if (Math.abs(rawSpan) >= 360) return [];
  const right = rawSpan < 0 ? east + 360 : east;
  const bottom = Math.max(south, -mercatorLatitudeLimit);
  const top = Math.min(north, mercatorLatitudeLimit);
  if (top <= bottom || right - west > maxViewportSpan || top - bottom > maxViewportSpan) return [];

  for (const step of regionSteps) {
    const firstColumn = Math.floor(west / step);
    const lastColumn = Math.ceil(right / step);
    if (!Number.isSafeInteger(firstColumn) || !Number.isSafeInteger(lastColumn)) continue;
    const firstRow = Math.floor(bottom / step);
    const lastRow = Math.ceil(top / step);
    if ((lastColumn - firstColumn) * (lastRow - firstRow) > maxRegions) continue;

    const regions: WeatherRegion[] = [];
    const worldColumns = 360 / step;
    const halfWorld = worldColumns / 2;
    for (let row = firstRow; row < lastRow; row++) {
      const cellSouth = Math.max(row * step, -mercatorLatitudeLimit);
      const cellNorth = Math.min((row + 1) * step, mercatorLatitudeLimit);
      for (let column = firstColumn; column < lastColumn; column++) {
        const canonicalColumn = ((column + halfWorld) % worldColumns + worldColumns) % worldColumns - halfWorld;
        regions.push({
          id: [step, canonicalColumn, row].join(':'),
          bounds: [column * step, cellSouth, (column + 1) * step, cellNorth],
          center: [(canonicalColumn + 0.5) * step, (cellSouth + cellNorth) / 2],
        });
      }
    }
    return regions;
  }

  return [];
}

function nonnegative(value: unknown, maximum = Infinity): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum ? value : null;
}

function parseWeather(value: unknown): CurrentWeather | null {
  if (!value || typeof value !== 'object') return null;
  const current = (value as { current?: Record<string, unknown> }).current;
  const rain = nonnegative(current?.rain);
  const showers = nonnegative(current?.showers);
  const snowCm = nonnegative(current?.snowfall);
  const cloudCover = nonnegative(current?.cloud_cover, 100);
  const time = nonnegative(current?.time);
  const interval = nonnegative(current?.interval);
  if (!time || !interval || (rain === null && showers === null && snowCm === null && cloudCover === null)) return null;

  return {
    rainMm: rain === null && showers === null ? null : (rain ?? 0) + (showers ?? 0),
    snowCm,
    cloudCover,
    isDay: current?.is_day === 1 ? true : current?.is_day === 0 ? false : undefined,
    time,
    interval,
  };
}

type WeatherSample = Pick<WeatherRegion, 'id' | 'center'>;

export async function fetchRegionWeather(samples: WeatherSample[], signal: AbortSignal) {
  const result = new Map<string, CurrentWeather>();
  if (!samples.length) return result;

  const query = new URLSearchParams({
    longitude: samples.map(({ center }) => center[0]).join(','),
    latitude: samples.map(({ center }) => center[1]).join(','),
    cell_selection: 'nearest',
    current: 'rain,showers,snowfall,cloud_cover,is_day',
    timeformat: 'unixtime',
    forecast_days: '1',
  });
  const response = await fetch('https://api.open-meteo.com/v1/forecast?' + query, { signal });
  if (!response.ok) {
    const retryAfter = response.headers.get('Retry-After');
    const retryDelay = retryAfter && (/^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now());
    const retryAfterMs = typeof retryDelay === 'number' && Number.isFinite(retryDelay) ? Math.min(86_400_000, Math.max(0, retryDelay)) : 0;
    throw Object.assign(new Error('Current weather request failed'), { status: response.status, retryAfterMs });
  }
  const payload: unknown = await response.json();
  const locations = Array.isArray(payload) ? payload : [payload];
  // A shortened batch cannot be mapped safely to IDs because the model returns its own grid coordinates.
  if (locations.length !== samples.length) return result;
  for (const [index, sample] of samples.entries()) {
    const weather = parseWeather(locations[index]);
    if (weather) result.set(sample.id, weather);
  }
  return result;
}

const store = new WeatherRegionStore(fetchRegionWeather);

export function useWeatherRegions(regions: WeatherRegion[]) {
  const sampleKey = JSON.stringify(regions.map(({ id, center, bounds }) => ({ id, center, bounds })));
  const owner = useMemo(() => Symbol('weather-viewport'), []);
  const [revision, setRevision] = useState(0);

  useEffect(() => store.subscribe(() => setRevision(value => value + 1)), []);
  useEffect(() => {
    const samples = JSON.parse(sampleKey) as WeatherRegion[];
    // Request the center first; completed batches become visible independently.
    const centerX = samples.reduce((sum, r) => sum + (r.bounds[0] + r.bounds[2]) / 2, 0) / samples.length;
    const centerY = samples.reduce((sum, r) => sum + r.center[1], 0) / samples.length;
    samples.sort((a, b) => Math.hypot((a.bounds[0] + a.bounds[2]) / 2 - centerX, a.center[1] - centerY) -
      Math.hypot((b.bounds[0] + b.bounds[2]) / 2 - centerX, b.center[1] - centerY));
    const update = () => {
      store.demand(owner, document.hidden ? [] : samples);
      setRevision(value => value + 1);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      store.demand(owner, []);
      document.removeEventListener('visibilitychange', update);
    };
  }, [sampleKey, owner]);

  return useMemo(() => store.snapshot(regions), [regions, revision]);
}
