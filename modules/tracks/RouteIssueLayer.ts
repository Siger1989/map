import type { Map } from 'maplibre-gl';
import type { Coordinate } from '../navigation/types.ts';

/** A temporary editing cue for a real fork or a terminal candidate. */
export class RouteIssueLayer {
  private map: Map;
  private point: Coordinate | null = null;
  private overlay: HTMLDivElement | null = null;
  constructor(map: Map) {
    this.map = map;
    if (typeof document !== 'undefined') {
      map.on('move', this.position);
      map.on('resize', this.position);
    }
  }

  private position = () => {
    if (!this.point || !this.overlay) return;
    const p = this.map.project(this.point);
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      this.overlay.style.left = `${p.x}px`;
      this.overlay.style.top = `${p.y}px`;
    }
  };

  sync(point: Coordinate | null, kind: 'fork' | 'candidate' = 'fork') {
    this.point = point;
    this.overlay?.remove();
    this.overlay = null;
    if (!point || typeof document === 'undefined') return;
    const overlay = document.createElement('div');
    overlay.dataset.routeIssue = kind;
    overlay.textContent = kind === 'fork' ? '分叉点 · 待设终点' : '末端候选 · 待设终点';
    Object.assign(overlay.style, {
      position: 'absolute', zIndex: '6', transform: 'translate(-50%, calc(-100% - 12px))',
      padding: '5px 8px', border: '2px solid #ffb020', borderRadius: '18px',
      background: '#263b4d', color: '#fff', fontSize: '12px', fontWeight: '800',
      whiteSpace: 'nowrap', boxShadow: '0 2px 8px #0009', pointerEvents: 'none',
    });
    const pin = document.createElement('span');
    Object.assign(pin.style, {
      position: 'absolute', left: '50%', bottom: '-11px', transform: 'translateX(-50%)',
      width: '12px', height: '12px', border: '3px solid #263b4d', borderRadius: '50%',
      background: '#ffb020', boxShadow: '0 1px 4px #0009',
    });
    overlay.appendChild(pin);
    this.overlay = overlay;
    this.map.getContainer().appendChild(overlay);
    this.position();
  }
}
