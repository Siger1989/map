import type { NativeMapBridgeClient } from './client.ts';
import type { NativeMapRenderState } from './types.ts';
import type { ShareMapStyle } from '../../routeShare/currentMapStyle.ts';
import { routeBounds, shareImageTerminals, type ShareRoute } from '../../routeShare/data.ts';
import { createNativeSceneGeometry } from './scene.ts';
import { usesSentinel, usesTianditu, SENTINEL_CREDIT } from '../../cartography/sentinel.ts';
import { basemapConfiguration, TIANDITU_CREDIT } from '../../cartography/basemaps.ts';
import { TERRAIN_CREDIT } from '../../terrain/terrain.ts';
import type { FeatureCollection } from 'geojson';

export function createNativeShareStyle(
  client: NativeMapBridgeClient, mapId: string,
  readState: (signal: AbortSignal) => Promise<NativeMapRenderState>,
): ShareMapStyle {
  const share: ShareMapStyle = {
    // Native print is the rendering authority; no synthetic web basemap is created.
    style: { version: 8, sources: {}, layers: [] },
    attribution: '当前地图图源及其原始署名 · 地形 FABDEM / Mapzen / SRTM',
    renderNative: async (data, signal) => {
      signal.throwIfAborted();
      const state = await readState(signal);
      const sourceCredit = state.mapSource?.attribution || (usesTianditu(state.settings, basemapConfiguration().domestic)
        ? TIANDITU_CREDIT : usesSentinel(state.settings) ? SENTINEL_CREDIT : '当前地形底图');
      share.attribution = [sourceCredit, state.settings.roads || state.settings.labels ? 'OpenFreeMap © OpenMapTiles · OpenStreetMap contributors' : '', TERRAIN_CREDIT]
        .filter(Boolean).join(' · ').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&copy;/g, '©');
      const track = data.track ? { ...data.track, segments: data.segments } : {
        id: 'share', name: data.name, createdAt: 0, segments: data.segments,
        style: { color: '#4dffb5', width: 4 },
      };
      const geometry = createNativeSceneGeometry({
        trackOverlay: { saved: [track], draft: [], visible: true, style: track.style ?? { color: '#4dffb5', width: 4 }, nodes: [], editing: false },
        guidanceOverlay: null, navigationCues: null,
        // Match the web print contract: only the requested track is exported.
        routeOverlay: { route: null, start: null, end: null, via: [] },
        position: null, positionNavigating: false,
      });
      geometry.tracks = withShareTrackStroke(geometry.tracks);
      const terminals = shareImageTerminals(data);
      const result = await client.request<{ dataUrl: string; width: number; height: number; terminals?: Array<{ x: number; y: number }> }>(mapId,
        'renderShareMap', {
          state: { ...state, settings: { ...state.settings, terrain: false }, photos: [], position: null },
          geometry, bounds: routeBounds(data.segments), terminals, markers: data.markers ?? [], width: 1200, height: 1250,
        // Native source readiness has its own 35s bound after the first frame;
        // allow that bounded work and capture to finish before the bridge deadline.
        }, { signal, timeoutMs: 80_000 });
      signal.throwIfAborted();
      if (!/^data:image\/(png|jpeg);base64,/.test(result.dataUrl) || result.width < 1 || result.height < 1) throw new Error('原生分享底图返回无效');
      const image = await decode(result.dataUrl, signal);
      signal.throwIfAborted();
      const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 1250;
      const context = canvas.getContext('2d'); if (!context) throw new Error('分享画布不可用');
      context.drawImage(image, 0, 0, 1200, 1250);
      drawTerminals(context, data, result, terminals);
      return canvas;
    },
  };
  return share;
}

/** Native print matches mapImage.ts: a 15px dark under-stroke plus 9px colored track. */
function withShareTrackStroke(collection: FeatureCollection): FeatureCollection {
  const lines = collection.features.filter(feature => feature.properties?.role === 'track');
  if (!lines.length) return collection;
  const halos = lines.map(feature => {
    const { nativePick: _nativePick, ...properties } = feature.properties ?? {};
    return { ...feature, properties: { ...properties, role: 'shareTrackHalo', color: '#063537', width: 15 } };
  });
  const colored = lines.map(feature => ({ ...feature, properties: { ...feature.properties, width: 9 } }));
  const rest = collection.features.filter(feature => feature.properties?.role !== 'track');
  return { ...collection, features: [...halos, ...colored, ...rest] };
}

function decode(url: string, signal: AbortSignal): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const abort = () => { cleanup(); image.src = ''; reject(signal.reason); };
    const cleanup = () => { image.onload = null; image.onerror = null; signal.removeEventListener('abort', abort); };
    image.onload = () => { cleanup(); resolve(image); };
    image.onerror = () => { cleanup(); reject(new Error('原生分享底图解码失败')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort(); else image.src = url;
  });
}

function drawTerminals(context: CanvasRenderingContext2D, data: ShareRoute,
  image: { width: number; height: number; terminals?: Array<{ x: number; y: number }> },
  terminals: ReturnType<typeof shareImageTerminals>) {
  context.font = 'bold 25px sans-serif';
  terminals.forEach((terminal, index) => {
    const pixel = image.terminals?.[index];
    if (pixel && Number.isFinite(pixel.x) && Number.isFinite(pixel.y)) {
      const x = pixel.x / image.width * 1200, y = pixel.y / image.height * 1250;
      context.beginPath(); context.arc(x, y, 12, 0, Math.PI * 2); context.fillStyle = terminal.color;
      context.fill(); context.strokeStyle = '#fff'; context.lineWidth = 4; context.stroke();
      const text = terminal.name === terminal.label ? terminal.label : `${terminal.label} · ${terminal.name}`;
      const width = Math.min(570, context.measureText(text).width + 30);
      const left = Math.max(20, Math.min(1180 - width, x + 18)), top = Math.max(140, Math.min(1170, y - 25));
      context.fillStyle = '#ffffffef'; context.fillRect(left, top, width, 34);
      context.fillStyle = '#102f37'; context.fillText(text, left + 15, top + 25, width - 30);
    }
  });
  context.fillStyle = '#102f37e8'; context.fillRect(20, 20, 1160, terminals.length > 1 ? 100 : 58);
  context.fillStyle = '#fff'; context.font = '25px sans-serif';
  terminals.forEach((terminal, i) => context.fillText(`${terminal.name === terminal.label ? terminal.label : `${terminal.label}：${terminal.name}`} · ${terminal.point[1].toFixed(5)}, ${terminal.point[0].toFixed(5)}`, 40, 48 + i * 42, 1120));
}
