import { memo, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import type { Coordinate } from '../navigation/types';
import { mercator, type Tile } from '../sky/satelliteTerrainGeometry';
import { loadSatelliteTile, satelliteImageryAvailable } from '../sky/satelliteTerrainTiles';
import { hourlyRainBand } from './routeWeatherAnalysis';
import './JourneyWeatherMap.css';

type RouteGeometry = { coordinates: readonly Coordinate[] };
type WeatherSegment = RouteGeometry & { rain: number | null };
type Point = readonly [number, number];
type Viewport = { width: number; height: number };
type Projection = Viewport & {
  scale: number;
  origin: Point;
  centerX: number;
};
type VisibleTile = { tile: Tile; left: number; top: number; extent: number };

const tileSize = 256;
const routePadding = 22;
const topPadding = 52;

function wrapNear(x: number, reference: number) {
  return x + Math.round(reference - x);
}

function routeProjection(segments: readonly RouteGeometry[], { width, height }: Viewport): Projection | null {
  const first = segments.find(segment => segment.coordinates.length)?.coordinates[0];
  if (!first || !width || !height) return null;

  const [referenceX, referenceY] = mercator(...first, 0);
  let left = referenceX;
  let right = referenceX;
  let top = referenceY;
  let bottom = referenceY;
  let previousX = referenceX;

  for (const { coordinates } of segments) {
    for (const coordinate of coordinates) {
      const [x, y] = mercator(...coordinate, 0);
      previousX = wrapNear(x, previousX);
      left = Math.min(left, previousX);
      right = Math.max(right, previousX);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  const scale = Math.max(1, Math.min(
    tileSize * 2 ** 18,
    Math.max(1, width - 2 * routePadding) / (right - left),
    Math.max(1, height - topPadding - routePadding) / (bottom - top),
  ));
  const centerX = (left + right) / 2;
  return {
    width,
    height,
    scale,
    centerX,
    origin: [centerX - width / (2 * scale), (top + bottom) / 2 - (height + topPadding - routePadding) / (2 * scale)],
  };
}

function project([x, y]: Point, { origin, scale }: Projection): Point {
  return [(x - origin[0]) * scale, (y - origin[1]) * scale];
}

function routePaths(segments: readonly WeatherSegment[], projection: Projection) {
  const first = segments.find(segment => segment.coordinates.length)?.coordinates[0];
  let previousX = first ? mercator(...first, 0)[0] : projection.centerX;
  return segments.map(({ coordinates }) => coordinates.map(coordinate => {
    const [x, y] = mercator(...coordinate, 0);
    previousX = wrapNear(x, previousX);
    return project([previousX, y], projection);
  }));
}

function visibleTiles({ origin, scale, width, height }: Projection): VisibleTile[] {
  const zoom = Math.max(1, Math.min(18, Math.floor(Math.log2(scale / tileSize))));
  const count = 2 ** zoom;
  const extent = scale / count;
  const spanX = width / scale;
  const spanY = height / scale;
  const result: VisibleTile[] = [];
  for (let y = Math.max(0, Math.floor(origin[1] * count)); y < Math.min(count, Math.ceil((origin[1] + spanY) * count)); y++) {
    for (let x = Math.floor(origin[0] * count); x < Math.ceil((origin[0] + spanX) * count); x++) {
      const wrappedX = ((x % count) + count) % count;
      result.push({
        tile: { z: zoom, x: wrappedX, y, key: `${zoom}/${wrappedX}/${y}` },
        left: (x - origin[0] * count) * extent,
        top: (y - origin[1] * count) * extent,
        extent,
      });
    }
  }
  return result;
}

const JourneyWeatherImagery = memo(function JourneyWeatherImagery({ projection }: { projection: Projection }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [coverage, setCoverage] = useState<'loading' | 'visible' | 'missing'>('loading');

  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || !satelliteImageryAvailable()) {
      setCoverage('missing');
      return;
    }
    const { width, height } = projection;
    const controller = new AbortController();
    const { signal } = controller;
    const tiles = visibleTiles(projection);
    context.clearRect(0, 0, width, height);
    setCoverage('loading');
    let drawn = 0;

    const byTile = new Map<string, VisibleTile[]>();
    for (const item of tiles) {
      const group = byTile.get(item.tile.key);
      if (group) group.push(item);
      else byTile.set(item.tile.key, [item]);
    }

    void Promise.all(Array.from(byTile.values(), async group => {
      try {
        const bitmap = await loadSatelliteTile(group[0].tile, signal);
        if (!bitmap) return;
        try {
          if (signal.aborted) return;
          for (const { left, top, extent } of group) {
            context.drawImage(bitmap, Math.round(left), Math.round(top), Math.round(left + extent) - Math.round(left), Math.round(top + extent) - Math.round(top));
          }
          drawn++;
          if (drawn === 1) setCoverage('visible');
        } finally {
          bitmap.close();
        }
      } catch {
        // Individual unavailable tiles leave the overview grid visible.
      }
    })).then(() => {
      if (!signal.aborted && drawn === 0) setCoverage('missing');
    });
    return () => controller.abort();
  }, [projection]);

  return <>
    <canvas ref={canvas} className="journey-weather-map-imagery" width={projection.width} height={projection.height} aria-hidden="true" />
    {coverage === 'visible' ? <small className="journey-weather-map-credit">影像 © 天地图</small> :
      <small className="journey-weather-map-credit">{coverage === 'loading' ? '正在加载天地图影像' : '天地图影像暂不可用'}</small>}
  </>;
});

function distanceSquared([x, y]: Point, [startX, startY]: Point, [endX, endY]: Point) {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((x - startX) * dx + (y - startY) * dy) / length));
  return (x - startX - t * dx) ** 2 + (y - startY - t * dy) ** 2;
}

export function JourneyWeatherMap({ geometry, segments, activeIndex, cursor, onSelect }: {
  geometry: readonly RouteGeometry[];
  segments: readonly WeatherSegment[];
  activeIndex: number;
  cursor: Coordinate | null;
  onSelect(index: number): void;
}) {
  const bounds = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const surface = bounds.current;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      setSize(old => old.width === width && old.height === height ? old : { width, height });
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  const projection = useMemo(() => routeProjection(geometry, size), [geometry, size]);
  const paths = useMemo(() => projection ? routePaths(segments, projection) : [], [segments, projection]);
  const lineAttributes = useMemo(() => paths.map(path => path.map(point => point.join(',')).join(' ')), [paths]);
  const selectedPath = paths[activeIndex];
  const focusIndex = selectedPath?.length ? activeIndex : paths.findIndex(path => path.length > 0);
  const cursorWorld = cursor && projection ? mercator(...cursor, 0) : null;
  const cursorPoint = cursorWorld && projection ? project([wrapNear(cursorWorld[0], projection.centerX), cursorWorld[1]], projection) : null;

  function selectClosest(event: MouseEvent<SVGSVGElement>) {
    if (!projection) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const target: Point = [
      (event.clientX - rect.left) * projection.width / rect.width,
      (event.clientY - rect.top) * projection.height / rect.height,
    ];
    let selected = -1;
    let closest = 22 ** 2;
    paths.forEach((path, index) => {
      path.forEach((point, pointIndex) => {
        const distance = distanceSquared(target, path[pointIndex - 1] ?? point, point);
        if (distance >= closest) return;
        selected = index;
        closest = distance;
      });
    });
    if (selected >= 0) onSelect(selected);
  }

  return <div className="journey-weather-map" ref={bounds}>
    {projection ? <>
      <JourneyWeatherImagery projection={projection} />
      <svg viewBox={`0 0 ${projection.width} ${projection.height}`} className="journey-weather-map-route"
        onClick={selectClosest} role="group" aria-label="沿途降水路线地图">
        <g className="journey-weather-map-outline" aria-hidden="true">
          {lineAttributes.map((points, index) => points && <polyline key={index} points={points} />)}
        </g>
        {lineAttributes.map((points, index) => {
          if (!points) return null;
          const rain = segments[index].rain;
          return <polyline key={index} points={points} className="journey-weather-map-segment" data-kind={hourlyRainBand(rain)}
            role="button" data-segment-index={index} tabIndex={index === focusIndex ? 0 : -1} aria-pressed={index === activeIndex}
            aria-label={`路段 ${index + 1}，${rain === null ? '预报缺测' : rain === 0 ? '无雨' : `小时雨量 ${rain} 毫米`}`}
            onClick={event => {
              if (event.detail === 0) {
                event.stopPropagation();
                onSelect(index);
              }
            }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(index);
              }
              if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                event.preventDefault();
                const step = event.key === 'ArrowRight' ? 1 : -1;
                let next = index + step;
                while (next >= 0 && next < paths.length && !paths[next].length) next += step;
                if (next < 0 || next >= segments.length) return;
                onSelect(next);
                const nextSegment = event.currentTarget.parentElement?.querySelector<SVGPolylineElement>(`[data-segment-index="${next}"]`);
                nextSegment?.focus();
              }
            }} />;
        })}
        {!!selectedPath?.length && <g className="journey-weather-map-active" data-kind={hourlyRainBand(segments[activeIndex].rain)} aria-hidden="true">
          <polyline points={lineAttributes[activeIndex]} />
          <polyline points={lineAttributes[activeIndex]} />
          <polyline points={lineAttributes[activeIndex]} />
        </g>}
        {cursorPoint && <g className="journey-weather-map-cursor" aria-hidden="true">
          <circle cx={cursorPoint[0]} cy={cursorPoint[1]} r="8" />
          <circle cx={cursorPoint[0]} cy={cursorPoint[1]} r="4" />
        </g>}
      </svg>
    </> : segments.length === 0 && <span className="journey-weather-map-empty">暂无路线位置</span>}
  </div>;
}
