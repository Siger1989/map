'use client';

import { useEffect, useMemo, useState } from 'react';

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
const maxViewportSpan = 8;
const maxRegions = 32;
const regionSteps = [0.0625, 0.125, 0.25, 0.5, 1, 2];

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
  });
  const response = await fetch('https://api.open-meteo.com/v1/forecast?' + query, { signal });
  if (!response.ok) throw new Error('Current weather request failed');
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

const refreshMs = 12 * 60_000;
const retryMs = 60_000;
const debounceMs = 500;
const cacheLimit = 256;
const cache = new Map<string, { weather: CurrentWeather | null; expires: number }>();

type WeatherStatus = 'loading' | 'ready' | 'unavailable';

export function useWeatherRegions(regions: WeatherRegion[]): {
  weather: ReadonlyMap<string, CurrentWeather>;
  status: WeatherStatus;
} {
  // Bounds move between world copies without changing the weather stations.
  const sampleKey = JSON.stringify(regions.map(({ id, center }) => ({ id, center })));
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const samples = JSON.parse(sampleKey) as WeatherSample[];
    if (!samples.length) return;
    let timer: number | undefined;
    let active: AbortController | undefined;

    const schedule = (delay: number) => {
      timer = window.setTimeout(() => void update(), delay);
    };

    const update = async () => {
      if (document.hidden) return;

      const now = Date.now();
      const missing = samples.filter(({ id }) => (cache.get(id)?.expires ?? 0) <= now);
      if (missing.length) {
        setRevision((revision) => revision + 1);
        const controller = new AbortController();
        active = controller;
        const timeout = window.setTimeout(() => controller.abort(), 10_000);
        let loaded = new Map<string, CurrentWeather>();
        try {
          loaded = await fetchRegionWeather(missing, controller.signal);
        } catch {
          // Retry failed cells after the same interval as cells with no current data.
        } finally {
          window.clearTimeout(timeout);
        }
        if (active !== controller) return;
        active = undefined;
        const finished = Date.now();
        for (const { id } of missing) {
          const weather = loaded.get(id) ?? null;
          cache.delete(id);
          cache.set(id, { weather, expires: finished + (weather ? refreshMs : retryMs) });
        }
        while (cache.size > cacheLimit) {
          const oldest = cache.keys().next();
          if (oldest.done) break;
          cache.delete(oldest.value);
        }
        setRevision((revision) => revision + 1);
      }

      const expiry = Math.min(...samples.map(({ id }) => cache.get(id)?.expires ?? 0));
      schedule(Math.max(debounceMs, expiry - Date.now()));
    };

    const cancel = () => {
      window.clearTimeout(timer);
      const pending = active;
      active = undefined;
      pending?.abort();
    };

    const handleVisibility = () => {
      cancel();
      if (!document.hidden) {
        setRevision((revision) => revision + 1);
        schedule(debounceMs);
      }
    };

    if (!document.hidden) schedule(debounceMs);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancel();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [sampleKey]);

  return useMemo(() => {
    const weather = new Map<string, CurrentWeather>();
    let missing = false;
    const now = Date.now();
    for (const { id } of regions) {
      const entry = cache.get(id);
      if (!entry || entry.expires <= now) missing = true;
      else if (entry.weather) weather.set(id, entry.weather);
    }
    return { weather, status: weather.size ? 'ready' : missing ? 'loading' : 'unavailable' };
  }, [regions, revision]);
}
