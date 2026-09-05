import type { Map } from 'maplibre-gl';
import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from '../tracks/drawing';
import type { TrackNode } from '../tracks/editing';

export type DragTarget =
  | { kind: 'track'; node: TrackNode }
  | { kind: 'annotation'; id: string; coordinate: Coordinate };
export type FeatureMove = { target: DragTarget; coordinate: Coordinate };
type Options = {
  enabled: () => boolean;
  hit: (point: ScreenPoint, element: EventTarget | null) => DragTarget | null;
  begin: (target: DragTarget) => void;
  preview: (move: FeatureMove | null) => void;
  commit: (move: FeatureMove) => void;
};
type Control = {
  isEnabled: () => boolean;
  enable: () => void;
  disable: () => void;
};

/** Observe native input while waiting; only lock the camera after a stationary hold. */
export class FeatureDragBridge {
  private map: Map;
  private options: Options;
  private ownerWindow: Window;
  private contacts = new Set<number>();
  private pending: {
    id: number;
    point: ScreenPoint;
    target: DragTarget;
  } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private last: FeatureMove | null = null;
  private offset = { x: 0, y: 0 };
  private controls: { control: Control; enabled: boolean }[] = [];
  private suppressUntil = 0;
  constructor(map: Map, options: Options) {
    this.map = map;
    this.options = options;
    this.ownerWindow = map.getCanvas().ownerDocument.defaultView!;
    this.ownerWindow.addEventListener('pointerdown', this.down, true);
    this.ownerWindow.addEventListener('pointermove', this.move, {
      capture: true,
      passive: false,
    });
    this.ownerWindow.addEventListener('pointerup', this.up, true);
    this.ownerWindow.addEventListener(
      'pointercancel',
      this.cancelPointer,
      true,
    );
    this.ownerWindow.addEventListener('keydown', this.key, true);
    this.ownerWindow.addEventListener('blur', this.blur);
    map.getContainer().addEventListener('click', this.click, true);
    map.getContainer().addEventListener('contextmenu', this.contextMenu, true);
  }
  private point(event: PointerEvent): ScreenPoint | null {
    const canvas = this.map.getCanvas(),
      rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: ((event.clientX - rect.left) * canvas.clientWidth) / rect.width,
      y: ((event.clientY - rect.top) * canvas.clientHeight) / rect.height,
    };
  }
  private down = (event: PointerEvent) => {
    this.contacts.add(event.pointerId);
    if (this.contacts.size > 1) {
      this.finish(false);
      return;
    }
    if (
      event.button !== 0 ||
      !this.options.enabled() ||
      !this.map.getContainer().contains(event.target as Node)
    )
      return;
    const point = this.point(event);
    if (!point) return;
    const target = this.options.hit(point, event.target);
    if (!target) return;
    this.map.stop();
    this.pending = { id: event.pointerId, point, target };
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.pending || this.contacts.size !== 1 || !this.options.enabled())
        return;
      const anchor = this.map.project(
        target.kind === 'track' ? target.node.coordinate : target.coordinate,
      );
      this.offset = { x: anchor.x - point.x, y: anchor.y - point.y };
      this.controls = [
        this.map.dragPan,
        this.map.dragRotate,
        this.map.touchZoomRotate,
        this.map.touchPitch,
        this.map.doubleClickZoom,
        this.map.scrollZoom,
        this.map.keyboard,
      ].map((control) => ({ control, enabled: control.isEnabled() }));
      this.controls.forEach(({ control }) => control.disable());
      this.map.stop();
      this.active = true;
      this.map.getContainer().classList.add('feature-drag-active');
      this.options.begin(target);
      this.options.preview({
        target,
        coordinate:
          target.kind === 'track' ? target.node.coordinate : target.coordinate,
      });
    }, 480);
  };
  private move = (event: PointerEvent) => {
    if (!this.pending || event.pointerId !== this.pending.id) return;
    const point = this.point(event);
    if (!point) return;
    if (!this.active) {
      if (
        Math.hypot(
          point.x - this.pending.point.x,
          point.y - this.pending.point.y,
        ) > 8
      )
        this.finish(false);
      return;
    }
    event.preventDefault();
    if (!this.options.enabled()) {
      this.finish(false);
      return;
    }
    const canvas = this.map.getCanvas();
    const aim = { x: point.x + this.offset.x, y: point.y + this.offset.y };
    // Do not commit a last valid position if the release is over sky/outside the map.
    this.last = null;
    if (
      Math.hypot(
        point.x - this.pending.point.x,
        point.y - this.pending.point.y,
      ) < 2
    )
      return;
    if (
      aim.x < 0 ||
      aim.y < 0 ||
      aim.x > canvas.clientWidth ||
      aim.y > canvas.clientHeight
    )
      return;
    const coordinate = this.map.unproject([aim.x, aim.y]).toArray();
    if (
      !coordinate.every(Number.isFinite) ||
      Math.abs(coordinate[0]) > 180 ||
      Math.abs(coordinate[1]) > 85
    )
      return;
    const check = this.map.project(coordinate);
    if (Math.hypot(check.x - aim.x, check.y - aim.y) > 8) return;
    this.last = { target: this.pending.target, coordinate };
    this.options.preview(this.last);
  };
  private up = (event: PointerEvent) => {
    if (event.pointerId === this.pending?.id) {
      if (this.active) this.move(event);
      this.finish(true);
    }
    this.contacts.delete(event.pointerId);
  };
  private cancelPointer = (event: PointerEvent) => {
    if (event.pointerId === this.pending?.id) this.finish(false);
    this.contacts.delete(event.pointerId);
  };
  private key = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.pending) {
      event.preventDefault();
      event.stopPropagation();
      this.finish(false);
    }
  };
  private blur = () => {
    this.finish(false);
    this.contacts.clear();
  };
  private click = (event: MouseEvent) => {
    if (this.blocksClick()) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  private contextMenu = (event: MouseEvent) => {
    if (this.pending || this.active || Date.now() < this.suppressUntil)
      event.preventDefault();
  };
  private finish(commit: boolean) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.active) {
      this.suppressUntil = Date.now() + 600;
      this.controls.forEach(({ control, enabled }) => {
        if (enabled) control.enable();
      });
      this.controls = [];
      this.map.getContainer().classList.remove('feature-drag-active');
      if (commit && this.last && this.options.enabled())
        this.options.commit(this.last);
      this.options.preview(null);
    }
    this.pending = null;
    this.active = false;
    this.last = null;
  }
  cancel() {
    this.finish(false);
  }
  blocksClick() {
    return this.active || Date.now() < this.suppressUntil;
  }
  dispose() {
    this.blur();
    this.ownerWindow.removeEventListener('pointerdown', this.down, true);
    this.ownerWindow.removeEventListener('pointermove', this.move, true);
    this.ownerWindow.removeEventListener('pointerup', this.up, true);
    this.ownerWindow.removeEventListener(
      'pointercancel',
      this.cancelPointer,
      true,
    );
    this.ownerWindow.removeEventListener('keydown', this.key, true);
    this.ownerWindow.removeEventListener('blur', this.blur);
    this.map.getContainer().removeEventListener('click', this.click, true);
    this.map
      .getContainer()
      .removeEventListener('contextmenu', this.contextMenu, true);
  }
}
