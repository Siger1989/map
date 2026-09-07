import type { Map } from 'maplibre-gl';
import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from '../tracks/drawing';

export type MapHold = { coordinate: Coordinate; point: ScreenPoint };
type Options = {
  enabled: () => boolean;
  occupied: (point: ScreenPoint) => boolean;
  hold: (value: MapHold) => void;
};

/** Empty-canvas hold only. Existing feature dragging owns its own gesture and persistence. */
export class MapLongPress {
  private map: Map;
  private options: Options;
  private owner: Window;
  private contacts = new Set<number>();
  private pending: {
    pointer: number;
    point: ScreenPoint;
    ready: boolean;
  } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private suppressUntil = 0;
  constructor(map: Map, options: Options) {
    this.map = map;
    this.options = options;
    this.owner = map.getCanvas().ownerDocument.defaultView!;
    this.owner.addEventListener('pointerdown', this.down, true);
    this.owner.addEventListener('pointermove', this.move, true);
    this.owner.addEventListener('pointerup', this.up, true);
    this.owner.addEventListener('pointercancel', this.cancelPointer, true);
    this.owner.addEventListener('blur', this.blur);
    this.owner.addEventListener('keydown', this.key, true);
    map.on('movestart', this.cancel);
    map.getContainer().addEventListener('click', this.click, true);
    map.getContainer().addEventListener('contextmenu', this.contextMenu, true);
  }
  private point(event: PointerEvent): ScreenPoint {
    const canvas = this.map.getCanvas(),
      rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.clientWidth) / rect.width,
      y: ((event.clientY - rect.top) * canvas.clientHeight) / rect.height,
    };
  }
  private ground(point: ScreenPoint): Coordinate | null {
    const canvas = this.map.getCanvas();
    if (
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.y) ||
      point.x < 0 ||
      point.y < 0 ||
      point.x > canvas.clientWidth ||
      point.y > canvas.clientHeight
    )
      return null;
    const coordinate = this.map.unproject([point.x, point.y]).toArray();
    if (!coordinate.every(Number.isFinite) || Math.abs(coordinate[1]) > 85)
      return null;
    const check = this.map.project(coordinate);
    if (
      !Number.isFinite(check.x) ||
      !Number.isFinite(check.y) ||
      Math.hypot(check.x - point.x, check.y - point.y) > 8
    )
      return null;
    return [((((coordinate[0] + 180) % 360) + 360) % 360) - 180, coordinate[1]];
  }
  private down = (event: PointerEvent) => {
    this.contacts.add(event.pointerId);
    if (this.contacts.size > 1) {
      this.cancel();
      return;
    }
    if (
      event.button !== 0 ||
      event.target !== this.map.getCanvas() ||
      !this.options.enabled()
    )
      return;
    const point = this.point(event);
    if (this.options.occupied(point) || !this.ground(point)) return;
    this.cancel();
    this.pending = { pointer: event.pointerId, point, ready: false };
    this.timer = setTimeout(() => {
      this.timer = null;
      if (
        !this.pending ||
        this.contacts.size !== 1 ||
        !this.options.enabled() ||
        this.options.occupied(point) ||
        !this.ground(point)
      ) {
        this.cancel();
        return;
      }
      this.pending.ready = true;
      this.map.getContainer().classList.add('map-hold-ready');
    }, 550);
  };
  private move = (event: PointerEvent) => {
    if (event.pointerId !== this.pending?.pointer) return;
    const point = this.point(event);
    if (
      !this.options.enabled() ||
      Math.hypot(
        point.x - this.pending.point.x,
        point.y - this.pending.point.y,
      ) > 8
    )
      this.cancel();
  };
  private up = (event: PointerEvent) => {
    if (event.pointerId === this.pending?.pointer) {
      this.move(event);
      const pending = this.pending;
      const coordinate =
        pending?.ready &&
        this.options.enabled() &&
        !this.options.occupied(pending.point)
          ? this.ground(pending.point)
          : null;
      this.cancel();
      if (coordinate && pending) {
        this.suppressUntil = Date.now() + 600;
        event.preventDefault();
        this.options.hold({ coordinate, point: pending.point });
      }
    }
    this.contacts.delete(event.pointerId);
  };
  private cancelPointer = (event: PointerEvent) => {
    if (event.pointerId === this.pending?.pointer) this.cancel();
    this.contacts.delete(event.pointerId);
  };
  private key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.pending) {
      this.cancel();
      event.preventDefault();
    }
  };
  private blur = () => {
    this.cancel();
    this.contacts.clear();
  };
  private click = (event: MouseEvent) => {
    if (this.blocksClick()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  private contextMenu = (event: MouseEvent) => {
    if (this.pending || this.blocksClick()) event.preventDefault();
  };
  cancel = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    this.map.getContainer().classList.remove('map-hold-ready');
  };
  blocksClick() {
    return Date.now() < this.suppressUntil;
  }
  dispose() {
    this.blur();
    this.owner.removeEventListener('pointerdown', this.down, true);
    this.owner.removeEventListener('pointermove', this.move, true);
    this.owner.removeEventListener('pointerup', this.up, true);
    this.owner.removeEventListener('pointercancel', this.cancelPointer, true);
    this.owner.removeEventListener('blur', this.blur);
    this.owner.removeEventListener('keydown', this.key, true);
    this.map.off('movestart', this.cancel);
    this.map.getContainer().removeEventListener('click', this.click, true);
    this.map
      .getContainer()
      .removeEventListener('contextmenu', this.contextMenu, true);
  }
}
