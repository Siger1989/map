import type { Map } from 'maplibre-gl';
import { addCartography, syncCartography } from '../cartography/cartography';
import { DEFAULT_LAYERS } from '../map/types';
import type { SectionProfileData, Contour } from './contours';
import type { profileMapData } from './profileMapData';

function ready(map: Map, event: 'load' | 'idle', signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const cancel = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('剖面平面底图加载超时，请联网后重试'));
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

/** Dedicated north-up map; never changes the user's camera or saved geometry. */
export async function renderProfileMap(
  data: SectionProfileData,
  active: Contour | undefined,
  plan: ReturnType<typeof profileMapData>,
  signal: AbortSignal,
) {
  const ml = await import('maplibre-gl');
  signal.throwIfAborted();
  ml.setWorkerUrl('/vendor/maplibre/maplibre-gl-worker.mjs');
  const width = 1472,
    height = 900;
  const container = document.createElement('div');
  container.style.cssText = `position:fixed;left:-10000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(container);
  let map: Map | undefined;
  try {
    map = new ml.Map({
      container,
      pixelRatio: 1,
      interactive: false,
      attributionControl: false,
      canvasContextAttributes: { preserveDrawingBuffer: true },
      fadeDuration: 0,
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
      center: data.settings.plane!.center,
      zoom: 1,
    });
    let failed = false;
    map.on('error', () => {
      failed = true;
    });
    await ready(map, 'load', signal);
    addCartography(map);
    syncCartography(map, { ...DEFAULT_LAYERS, terrain: false });
    const { unwrap } = plan;
    const border = [...plan.corners, plan.corners[0]].map((p) =>
      unwrap(p.point.coordinates),
    );
    map.addSource('profile-plan', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { border: true, active: false },
            geometry: { type: 'LineString', coordinates: border },
          },
          ...data.curves
            .filter((c) => c.points.length >= 2)
            .map((c) => ({
              type: 'Feature' as const,
              properties: { border: false, active: c.id === active?.id },
              geometry: {
                type: 'LineString' as const,
                coordinates: c.points.map((p) => unwrap(p.coordinates)),
              },
            })),
        ],
      },
    });
    map.addLayer({
      id: 'profile-border',
      type: 'line',
      source: 'profile-plan',
      filter: ['==', 'border', true],
      paint: {
        'line-color': '#acffe0',
        'line-width': 5,
        'line-dasharray': [3, 2],
      },
    });
    map.addLayer({
      id: 'profile-curves',
      type: 'line',
      source: 'profile-plan',
      filter: ['==', 'border', false],
      paint: {
        'line-color': ['case', ['get', 'active'], '#ffab63', '#a4c8d2'],
        'line-width': 3,
      },
    });
    const idle = ready(map, 'idle', signal);
    map.fitBounds(plan.bounds, {
      padding: 100,
      maxZoom: 19,
      duration: 0,
      bearing: 0,
      pitch: 0,
    });
    await idle;
    signal.throwIfAborted();
    if (failed) throw new Error('部分平面底图或地名加载失败，请联网后重试保存');
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法生成剖面平面地图');
    ctx.drawImage(map.getCanvas(), 0, 0);
    // Projected vertical corners and coincident measurements share a label, never a false offset location.
    const groups: { x: number; y: number; labels: string[]; color: string }[] =
      [];
    for (const p of plan.points) {
      const xy = map.project(unwrap(p.point.coordinates));
      if (xy.x < 0 || xy.x > width || xy.y < 0 || xy.y > height)
        throw new Error('剖面边框或测点未完整纳入地图，请重试');
      ctx.beginPath();
      ctx.arc(xy.x, xy.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 3;
      ctx.stroke();
      const group = groups.find((g) => Math.hypot(g.x - xy.x, g.y - xy.y) < 18);
      if (group) group.labels.push(p.label);
      else groups.push({ x: xy.x, y: xy.y, labels: [p.label], color: p.color });
    }
    ctx.font = 'bold 25px sans-serif';
    ctx.textBaseline = 'middle';
    const boxes: { x: number; y: number; w: number; h: number }[] = [];
    for (const g of groups) {
      const text =
        g.labels.length <= 8
          ? g.labels.join(' / ')
          : `${g.labels.slice(0, 3).join(' / ')} 等${g.labels.length}点`;
      const w = Math.min(width - 40, ctx.measureText(text).width + 24),
        h = 40;
      let x = Math.min(width - w - 16, Math.max(16, g.x + 16));
      let y = Math.max(50, Math.min(height - h - 50, g.y - 50));
      for (let step = 0; step < 16; step++) {
        const candidate = Math.max(
          50,
          Math.min(
            height - h - 50,
            g.y - 50 + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 46,
          ),
        );
        if (
          !boxes.some(
            (b) =>
              x < b.x + b.w + 6 &&
              x + w + 6 > b.x &&
              candidate < b.y + b.h + 6 &&
              candidate + h + 6 > b.y,
          )
        ) {
          y = candidate;
          break;
        }
      }
      boxes.push({ x, y, w, h });
      ctx.strokeStyle = '#e9fff6';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(Math.max(x, Math.min(x + w, g.x)), y + h / 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffffef';
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#173e39';
      ctx.fillText(text, x + 12, y + h / 2);
    }
    ctx.fillStyle = '#102f37e8';
    ctx.fillRect(width - 94, 16, 78, 44);
    ctx.fillStyle = '#fff';
    ctx.fillText('北 ↑', width - 82, 38);
    ctx.fillStyle = '#102f37ef';
    ctx.fillRect(0, height - 38, width, 38);
    ctx.fillStyle = '#fff';
    ctx.font = '21px sans-serif';
    ctx.fillText(
      '底图 © OpenStreetMap contributors · OpenFreeMap ｜ 北向上 · WGS84',
      20,
      height - 19,
    );
    return canvas;
  } finally {
    map?.remove();
    container.remove();
  }
}
