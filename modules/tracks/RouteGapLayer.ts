import type { Feature } from 'geojson';
import type { Map } from 'maplibre-gl';
import { syncOverlayData } from '../map/overlayData.ts';
import type { RouteGap } from './routeInfo.ts';
import type { Coordinate } from '../navigation/types.ts';

/** A display-only connector that marks, but never fills, a broken saved route. */
export class RouteGapLayer {
  private map: Map;
  private gap: RouteGap | null = null;
  private overlay: HTMLDivElement | null = null;
  private ends: HTMLDivElement[] = [];
  private connector: HTMLDivElement | null = null;
  private caption: HTMLDivElement | null = null;
  constructor(map: Map) {
    this.map = map;
    if (typeof document !== 'undefined') {
      map.on('move', this.position);
      map.on('resize', this.position);
    }
  }

  private position = () => {
    if (!this.gap || !this.overlay || !this.connector || !this.caption) return;
    const screen = (coordinate: Coordinate) => {
      const projected = this.map.project(coordinate);
      const container = this.map.getContainer();
      const width = container.clientWidth, height = container.clientHeight;
      if (Math.abs(projected.x - width / 2) < width * 2 && Math.abs(projected.y - height / 2) < height * 2)
        return projected;
      // In an unpainted WebView frame MapLibre can briefly return world pixels.
      // Keep the missing-connection callout in view until normal projection resumes.
      const center = this.map.getCenter();
      const size = 512 * 2 ** this.map.getZoom();
      const mercatorY = (latitude: number) => {
        const radians = Math.max(-85, Math.min(85, latitude)) * Math.PI / 180;
        return (1 - Math.log(Math.tan(Math.PI / 4 + radians / 2)) / Math.PI) * size / 2;
      };
      const rawDx = (coordinate[0] - center.lng) / 360 * size;
      const dx = rawDx - Math.round(rawDx / size) * size;
      return { x: width / 2 + dx, y: height / 2 + mercatorY(coordinate[1]) - mercatorY(center.lat) };
    };
    const a = screen(this.gap.from), b = screen(this.gap.to);
    if (![a.x, a.y, b.x, b.y].every(Number.isFinite)) return;
    for (const [index, point] of [a, b].entries()) {
      this.ends[index].style.left = `${point.x}px`;
      this.ends[index].style.top = `${point.y}px`;
    }
    const dx = b.x - a.x, dy = b.y - a.y;
    this.connector.style.left = `${a.x}px`;
    this.connector.style.top = `${a.y}px`;
    this.connector.style.width = `${Math.hypot(dx, dy)}px`;
    this.connector.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
    this.caption.style.left = `${(a.x + b.x) / 2}px`;
    this.caption.style.top = `${(a.y + b.y) / 2 - 26}px`;
  };

  private showDom(gap: RouteGap | null) {
    if (typeof document === 'undefined' || !this.map.getContainer) return;
    this.overlay?.remove();
    this.overlay = null;
    if (!gap) return;
    const overlay = document.createElement('div');
    overlay.dataset.routeGap = 'true';
    Object.assign(overlay.style, { position: 'absolute', inset: '0', zIndex: '5', pointerEvents: 'none', overflow: 'hidden' });
    const connector = document.createElement('div');
    Object.assign(connector.style, { position: 'absolute', height: '0', borderTop: '3px dashed #d92d20', transformOrigin: 'left center' });
    overlay.appendChild(connector);
    this.ends = ['断点 A', '断点 B'].map((label) => {
      const end = document.createElement('div');
      end.textContent = label;
      Object.assign(end.style, { position: 'absolute', transform: 'translate(-50%, -50%)', padding: '3px 5px', border: '2px solid #d92d20', borderRadius: '16px', background: '#fff9ef', color: '#8f1d14', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap', boxShadow: '0 1px 3px #0008' });
      overlay.appendChild(end);
      return end;
    });
    const caption = document.createElement('div');
    caption.textContent = `断开约 ${Math.max(0.1, Math.round(gap.distance * 10) / 10)} 米`;
    Object.assign(caption.style, { position: 'absolute', transform: 'translate(-50%, -50%)', padding: '2px 4px', borderRadius: '3px', background: '#d92d20', color: 'white', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' });
    overlay.appendChild(caption);
    this.overlay = overlay;
    this.connector = connector;
    this.caption = caption;
    this.map.getContainer().appendChild(overlay);
    this.position();
  }

  sync(gap: RouteGap | null) {
    const map = this.map;
    this.gap = gap;
    this.showDom(gap);
    if (!map.getSource('route-gap'))
      map.addSource('route-gap', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
    if (!map.getLayer('route-gap-line')) {
      map.addLayer({
        id: 'route-gap-line', type: 'line', source: 'route-gap',
        filter: ['==', '$type', 'LineString'],
        paint: { 'line-color': '#e55332', 'line-width': 4, 'line-dasharray': [1.5, 1.5] },
      });
      map.addLayer({
        id: 'route-gap-points', type: 'circle', source: 'route-gap',
        filter: ['==', '$type', 'Point'],
        paint: { 'circle-color': '#fff4ed', 'circle-radius': 8, 'circle-stroke-color': '#e55332', 'circle-stroke-width': 3 },
      });
    }
    const features: Feature[] = gap
      ? [
          { type: 'Feature', properties: { kind: 'missing-connection' }, geometry: { type: 'LineString', coordinates: [gap.from, gap.to] } } as Feature,
          ...[gap.from, gap.to].map((coordinates) => ({ type: 'Feature', properties: { kind: 'gap-end' }, geometry: { type: 'Point', coordinates } } as Feature)),
        ]
      : [];
    syncOverlayData(map, 'route-gap', { type: 'FeatureCollection', features });
  }
}
