import type { Map } from 'maplibre-gl';
import { addCartography, syncCartography } from '../cartography/cartography';
import { DEFAULT_LAYERS } from '../map/types';
import { routeBounds, type ShareRoute } from './data';

function ready(map: Map, event: 'load' | 'idle', signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
        cleanup();
        resolve();
      },
      cancel = () => {
        cleanup();
        reject(signal.reason);
      };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('分享底图或地名加载超时，请检查网络后重试'));
    }, 35000);
    const cleanup = () => {
      clearTimeout(timer);
      map.off(event, done);
      signal.removeEventListener('abort', cancel);
    };
    map.once(event, done);
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
  });
}
/** Independent flat map with complete bounds and labels. The interactive map is never moved. */
export async function renderRouteMap(data: ShareRoute, signal: AbortSignal) {
  const ml = await import('maplibre-gl');
  signal.throwIfAborted();
  ml.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
  const container = document.createElement('div');
  container.style.cssText =
    'position:fixed;left:-10000px;top:0;width:1200px;height:1250px;pointer-events:none;';
  document.body.appendChild(container);
  let map: Map | undefined;
  try {
    map = new ml.Map({
      container,
      pixelRatio: 1,
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      style: {
        version: 8,
        glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#203b3f' },
          },
          {
            id: 'hillshade',
            type: 'background',
            paint: { 'background-opacity': 0 },
          },
        ],
      },
      center: [0, 20],
      zoom: 1,
      fadeDuration: 0,
    });
    await ready(map, 'load', signal);
    let failed = false;
    map.on('error', () => {
      failed = true;
    });
    addCartography(map);
    syncCartography(map, { ...DEFAULT_LAYERS, terrain: false });
    const bounds = routeBounds(data.segments),
      center = (bounds[0][0] + bounds[1][0]) / 2;
    const unwrap = ([lng, lat]: [number, number]): [number, number] => [
      center + ((((lng - center + 180) % 360) + 360) % 360) - 180,
      lat,
    ];
    map.addSource('share-line', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'MultiLineString',
          coordinates: data.segments.map((s) => s.map(unwrap)),
        },
      },
    });
    map.addLayer({
      id: 'share-outline',
      type: 'line',
      source: 'share-line',
      paint: { 'line-color': '#063537', 'line-width': 15 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    map.addLayer({
      id: 'share-line',
      type: 'line',
      source: 'share-line',
      paint: { 'line-color': '#4dffb5', 'line-width': 9 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
    const stops = data.stops.map((s, i) => ({
      type: 'Feature' as const,
      properties: {
        label:
          i === 0
            ? '起点'
            : i === data.stops.length - 1
              ? '终点'
              : `${data.approach && i === 1 ? '主体起点' : '途经点 ' + i}`,
      },
      geometry: { type: 'Point' as const, coordinates: unwrap(s.coordinates) },
    }));
    map.addSource('share-stops', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: stops },
    });
    map.addLayer({
      id: 'share-stops',
      type: 'circle',
      source: 'share-stops',
      paint: {
        'circle-color': '#f1fff6',
        'circle-radius': 7,
        'circle-stroke-width': 3,
        'circle-stroke-color': '#157953',
      },
    });
    map.addLayer({
      id: 'share-stop-names',
      type: 'symbol',
      source: 'share-stops',
      filter: [
        'all',
        ['!=', ['get', 'label'], '起点'],
        ['!=', ['get', 'label'], '终点'],
      ],
      layout: {
        'text-field': ['get', 'label'],
        'text-font': ['Noto Sans Regular'],
        'text-size': 20,
        'text-offset': [0, 1.2],
        'text-allow-overlap': true,
      },
      paint: {
        'text-color': '#fff',
        'text-halo-color': '#173b3d',
        'text-halo-width': 2,
      },
    });
    if (data.markers?.length) {
      map.addSource('share-markers', {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: data.markers.map((m) => ({
            type: 'Feature',
            properties: { name: m.name, color: m.color },
            geometry: { type: 'Point', coordinates: unwrap(m.coordinates) },
          })),
        },
      });
      map.addLayer({
        id: 'share-markers',
        type: 'circle',
        source: 'share-markers',
        paint: {
          'circle-color': ['get', 'color'],
          'circle-radius': 8,
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'share-marker-labels',
        type: 'symbol',
        source: 'share-markers',
        layout: {
          'text-field': ['get', 'name'],
          'text-font': ['Noto Sans Regular'],
          'text-size': 18,
          'text-offset': [0, -1.2],
          'text-anchor': 'bottom',
        },
        paint: {
          'text-color': '#ffffff',
          'text-halo-color': '#173b3d',
          'text-halo-width': 2,
        },
      });
    }
    const idle = ready(map, 'idle', signal);
    map.fitBounds(bounds, {
      padding: { top: 165, bottom: 85, left: 85, right: 85 },
      maxZoom: 16,
      duration: 0,
      bearing: 0,
      pitch: 0,
    });
    await idle;
    signal.throwIfAborted();
    if (!map.queryRenderedFeatures({ layers: ['share-line'] }).length)
      throw new Error('路线未完整绘制，请重试');
    if (failed) throw new Error('部分地图或地名加载失败，请重试后生成完整图片');
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 1250;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法生成地图图片');
    ctx.drawImage(map.getCanvas(), 0, 0, 1200, 1250);
    const endpoints = [
      {
        name: data.stops[0]?.name || '起点',
        point: data.segments[0][0],
        label: '起点',
        color: '#087747',
      },
      {
        name: data.stops.at(-1)?.name || '终点',
        point: data.segments.at(-1)!.at(-1)!,
        label: '终点',
        color: '#ce3c45',
      },
    ];
    ctx.font = 'bold 23px sans-serif';
    ctx.textBaseline = 'middle';
    let previousLabel: { x: number; y: number; width: number } | null = null;
    for (const endpoint of endpoints) {
      const p = map.project(unwrap(endpoint.point));
      if (p.x < 0 || p.y < 0 || p.x > 1200 || p.y > 1250)
        throw new Error('起终点未完整纳入图片，请重试');
      ctx.beginPath();
      ctx.arc(p.x, p.y, 13, 0, Math.PI * 2);
      ctx.fillStyle = endpoint.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 4;
      ctx.stroke();
      const text =
          endpoint.name === endpoint.label
            ? endpoint.label
            : endpoint.label + ' · ' + endpoint.name,
        width = Math.min(570, ctx.measureText(text).width + 30),
        x = Math.max(20, Math.min(1180 - width, p.x + 18));
      let y = Math.max(140, Math.min(1170, p.y - 25));
      if (
        previousLabel &&
        x < previousLabel.x + previousLabel.width &&
        x + width > previousLabel.x &&
        Math.abs(y - previousLabel.y) < 52
      )
        y =
          previousLabel.y <= 1118 ? previousLabel.y + 52 : previousLabel.y - 52;
      previousLabel = { x, y, width };
      ctx.fillStyle = '#ffffffef';
      ctx.fillRect(x, y, width, 46);
      ctx.fillStyle = endpoint.color;
      ctx.fillText(text, x + 15, y + 23, width - 30);
    }
    ctx.fillStyle = '#102f37e8';
    ctx.fillRect(20, 20, 1160, 100);
    ctx.fillStyle = '#fff';
    ctx.font = '25px sans-serif';
    endpoints.forEach((p, i) =>
      ctx.fillText(
        `${p.name === p.label ? p.label : p.label + '：' + p.name} · ${p.point[1].toFixed(5)}, ${p.point[0].toFixed(5)}`,
        40,
        48 + i * 42,
        1120,
      ),
    );
    return canvas;
  } finally {
    map?.remove();
    container.remove();
  }
}
