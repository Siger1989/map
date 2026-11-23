'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MapHandle } from '@/modules/map/TerrainMap';
import type { ProjectionFrame } from '@/modules/objectTransform/projection';
import { drawWeatherRegions, type ProjectedWeatherRegion } from './drawWeatherRegions';
import { planWeatherRegions, useWeatherRegions, type CurrentWeather, type WeatherBounds, type WeatherRegion } from './liveWeatherRegions';
import './liveMapWeather.css';

type MapRef = RefObject<MapHandle | null>;
type RegionWeather = WeatherRegion & { weather: CurrentWeather };

function wrapLongitude(longitude: number) {
  return longitude - 360 * Math.floor((longitude + 180) / 360);
}

function visibleWeatherBounds(map: MapHandle, frame: ProjectionFrame): WeatherBounds | null {
  const bounds = map.offlineRegionBounds(true);
  if (bounds && (bounds[2] - bounds[0] < 180 || Math.abs(frame.longitude) < 172)) return bounds;

  // At the antimeridian native corner coordinates wrap independently.
  // In tilted views, corners in the sky may have no ground intersection.
  const points: [number, number][] = [];
  for (const y of [0, frame.height / 2, frame.height]) {
    for (const x of [0, frame.width / 2, frame.width]) {
      const coordinate = map.toCoordinate({ x, y });
      if (coordinate) points.push([frame.longitude + wrapLongitude(coordinate[0] - frame.longitude), coordinate[1]]);
    }
  }
  if (points.length < 2) return null;
  const longitudes = points.map(point => point[0]);
  const latitudes = points.map(point => point[1]);
  return [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)];
}

function useVisibleRegions(mapRef: MapRef) {
  const [regions, setRegions] = useState<WeatherRegion[] | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let latest: ProjectionFrame | undefined;
    let timer: number | undefined;
    let lastPose = '';
    const update = () => {
      if (!latest || document.hidden) return;
      const bounds = visibleWeatherBounds(map, latest);
      const next = bounds ? planWeatherRegions(bounds) : [];
      setRegions(previous => previous && previous.length === next.length &&
        previous.every((cell, index) => cell.id === next[index].id) ? previous : next);
    };
    const stop = map.watchObjectProjection(frame => {
      latest = frame;
      const camera = map.cameraSnapshot();
      if (!camera || document.hidden) return;
      const pose = [frame.width, frame.height, ...camera.center, camera.pitch, camera.bearing, camera.zoom].join(',');
      if (pose === lastPose) return;
      lastPose = pose;
      window.clearTimeout(timer);
      timer = window.setTimeout(update, 150);
    });
    document.addEventListener('visibilitychange', update);
    return () => {
      stop();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, [mapRef]);

  return regions;
}

function projectRegions(map: MapHandle, frame: ProjectionFrame, cells: readonly RegionWeather[]) {
  const result: ProjectedWeatherRegion[] = [];
  const points = new Map<string, ReturnType<MapHandle['toScreen']>>();
  const project = (longitude: number, latitude: number) => {
    const x = frame.nativeFrame ? wrapLongitude(longitude) : longitude;
    const key = x + ',' + latitude;
    if (!points.has(key)) points.set(key, map.toScreen([x, latitude]));
    return points.get(key);
  };

  for (const { id, bounds: [west, south, east, north], weather } of cells) {
    // Include known clear samples so cloud density can fade toward them across cells.
    if (!(weather.snowCm || weather.rainMm || weather.cloudCover !== null)) continue;
    // Keep both sides of the same cell in the world copy nearest the map.
    const shift = 360 * Math.round((frame.longitude - (west + east) / 2) / 360);
    const nw = project(west + shift, north);
    const ne = project(east + shift, north);
    const se = project(east + shift, south);
    const sw = project(west + shift, south);
    if (nw && ne && se && sw) result.push({ id, corners: [nw, ne, se, sw], bounds: [west + shift, south, east + shift, north], weather });
  }
  return result;
}

function WeatherCanvas({ mapRef, cells }: { mapRef: MapRef; cells: readonly RegionWeather[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestCells = useRef(cells);
  latestCells.current = cells;
  const invalidate = useRef<(() => void) | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!map || !canvas || !ctx) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0;
    let height = 0;
    let timer: number | undefined;
    let frame: ProjectionFrame | undefined;
    let previousFrame: ProjectionFrame | undefined;
    let previousCells: readonly RegionWeather[] | undefined;
    let projected: ProjectedWeatherRegion[] = [];
    const startingTime = performance.now();

    const render = () => {
      window.clearTimeout(timer);
      if (document.hidden || width === 0 || height === 0) return;
      if (frame && (frame !== previousFrame || latestCells.current !== previousCells)) {
        projected = projectRegions(map, frame, latestCells.current);
        previousFrame = frame;
        previousCells = latestCells.current;
      }
      const seconds = reducedMotion.matches ? 0 : (performance.now() - startingTime) / 1000;
      drawWeatherRegions(ctx, width, height, projected, seconds);
      if (!reducedMotion.matches && projected.length) timer = window.setTimeout(render, 1000 / 24);
    };

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const pixelRatio = Math.min(1.5, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      render();
    };

    const stop = map.watchObjectProjection(next => {
      frame = next;
      if (reducedMotion.matches || !projected.length) render();
    });
    invalidate.current = render;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    reducedMotion.addEventListener('change', render);
    document.addEventListener('visibilitychange', render);
    return () => {
      stop();
      invalidate.current = null;
      window.clearTimeout(timer);
      observer.disconnect();
      reducedMotion.removeEventListener('change', render);
      document.removeEventListener('visibilitychange', render);
    };
  }, [mapRef]);

  useEffect(() => { invalidate.current?.(); }, [cells]);

  return <canvas className="live-map-weather-canvas" ref={canvasRef} aria-hidden="true" />;
}

const emptyRegions: WeatherRegion[] = [];

export function LiveMapWeather({ mapRef }: { mapRef: MapRef }) {
  const regions = useVisibleRegions(mapRef);
  const { cells, status, refreshing, stale } = useWeatherRegions(regions ?? emptyRegions);

  const snowRegions = cells.filter(cell => (cell.weather.snowCm ?? 0) > 0).length;
  const rainRegions = cells.filter(cell => (cell.weather.rainMm ?? 0) > 0).length;
  const dryRegions = cells.filter(cell => cell.weather.rainMm === 0 && cell.weather.snowCm === 0).length;
  const cloudRegions = cells.filter(cell => (cell.weather.cloudCover ?? 0) >= 40).length;
  const newest = Math.max(0, ...cells.map(cell => cell.weather.time));
  const modelTime = newest > 0 ? new Date(newest * 1000) : null;
  const conditions = [
    snowRegions > 0 ? (snowRegions === cells.length ? '降雪' : '局地降雪') : '',
    rainRegions > 0 ? (rainRegions === cells.length ? '降雨' : '局地降雨') : '',
    cloudRegions > 0 ? (cells.every(cell => (cell.weather.cloudCover ?? 0) >= 75) ? '阴' : '多云') : '',
  ].filter(Boolean);
  const summary = !regions ? '正在读取地图范围' : !regions.length ? '放大地图查看' :
    cells.length ? (conditions.join(' · ') || (dryRegions === cells.length ? '无降水' : '部分数据暂缺')) :
    status === 'loading' ? '正在更新' : '天气连接较慢 · 正在重试';

  return (
    <div className="live-map-weather"
      data-region-count={regions?.length}
      data-loaded-regions={cells.length}
      data-weather-refreshing={refreshing}
      data-weather-stale={stale}
      data-snow-regions={snowRegions}
      data-rain-regions={rainRegions}
      data-dry-regions={dryRegions}
      data-weather-source={modelTime ? 'Open-Meteo' : undefined}>
      {cells.length > 0 && <WeatherCanvas mapRef={mapRef} cells={cells} />}
      <div className="live-map-weather-status" title={modelTime ? 'Open-Meteo 区域模型估算 · ' + modelTime.toLocaleString() : undefined}>
        区域天气 · {summary}{cells.length > 0 && refreshing ? ' · 更新中' : stale ? ' · 缓存' : ''}
        {modelTime && <span className="live-map-weather-source">
          Open-Meteo · {modelTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </span>}
      </div>
    </div>
  );
}
