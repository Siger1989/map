import type { Coordinate } from '../../navigation/types.ts';
import type { TrackNode } from '../../tracks/editing.ts';
import type { DragTarget, FeatureMove } from '../FeatureDragBridge.ts';
import type { NativeMapBridgeClient, NativeMapEventHandler } from './client.ts';
import { projectNativeLocal, unprojectNativeLocal } from './localGeometry.ts';

export const NATIVE_MAP_GESTURE_EVENT = 'shantu:native-map-gesture';
const HOLD_MS = 480;
const MOVE_CANCEL_PX = 8;
const DRAG_MIN_PX = 2;

export type NativeRawTouch = {
  gestureId: string | number;
  action: number;
  x: number;
  y: number;
  pointerCount: number;
  pointers?: Array<{ id: number; x: number; y: number }>;
  downTime?: number;
  eventTime?: number;
};
export type NativeHitTest = {
  gestureId: string | number;
  pointerId: number;
  downTime?: number;
  eventTime?: number;
  point: { x: number; y: number };
  coordinate: Coordinate | null;
  ids: string[];
  exactIds?: string[];
};
export type NativeMapHold = { coordinate: Coordinate; point: { x: number; y: number } };
export type NativeGestureDetail = {
  mapId: string;
  gestureId: string | number;
  pointerId: number;
  pointerCount: number;
  phase: 'start' | 'end' | 'cancel';
  x: number;
  y: number;
  eventTime?: number;
  source: 'native';
};

export type NativeMapInteractionOptions = {
  client: NativeMapBridgeClient;
  mapId: string;
  enabled: () => boolean;
  /** Resolve real native pick IDs against current business props; return only editable targets. */
  resolveTarget: (hit: NativeHitTest) => DragTarget | null;
  onDragBegin: (target: DragTarget) => void;
  onDragPreview: (move: FeatureMove | null) => void;
  onDragCommit: (move: FeatureMove) => void;
  onMapHold?: (hold: NativeMapHold) => void;
  direct?: (target: DragTarget) => boolean;
  snap?: (target: DragTarget, point: { x: number; y: number }) => TrackNode | null;
  occupied?: (hit: NativeHitTest) => boolean;
  dispatchGesture?: (detail: NativeGestureDetail) => void;
};

type Pending = {
  gestureId: string | number;
  pointerId: number;
  downTime?: number;
  point: { x: number; y: number };
  target: DragTarget | null;
  hit: NativeHitTest | null;
  hitResolved: boolean;
  occupied: boolean;
  active: boolean;
  cancelled: boolean;
  offset: { x: number; y: number };
  last: FeatureMove | null;
  released: boolean;
  queuedLongPress: unknown | null;
};

/**
 * Adapt actual Android MotionEvent/pick-buffer events to the original map gesture callbacks.
 * This deliberately emits a named CustomEvent for focus-lock integration; it never fabricates
 * trusted PointerEvents or substitutes browser/MapLibre geometry for the native camera frame.
 */
export class NativeMapInteractionAdapter {
  private readonly options: NativeMapInteractionOptions;
  private removers: Array<() => void> = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: Pending | null = null;
  private capturedGesture: string | number | null = null;
  private suppressClickUntil = 0;
  private started = false;

  constructor(options: NativeMapInteractionOptions) { this.options = options; }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.removers = [
      this.options.client.subscribe(this.options.mapId, 'touch', this.onTouch),
      this.options.client.subscribe(this.options.mapId, 'hitTest', this.onHitTest),
      this.options.client.subscribe(this.options.mapId, 'gestureCancel', this.onGestureCancel),
      this.options.client.subscribe(this.options.mapId, 'longPress', this.onLongPress),
    ];
  }

  /** True while a long press or active drag must suppress the trailing native tap. */
  blocksClick(): boolean { return this.pending?.active === true || Date.now() < this.suppressClickUntil; }

  private onTouch: NativeMapEventHandler = (value) => {
    const touch = readTouch(value);
    if (!touch) return;
    const point = { x: touch.x, y: touch.y };
    const primary = touch.pointers?.[0];
    const pointerId = primary?.id ?? 0;

    if (touch.pointerCount > 1 || touch.action === 5) {
      this.cancel(touch, pointerId);
      return;
    }
    if (touch.action === 0) {
      this.cancel(this.pending ? { ...touch, gestureId: this.pending.gestureId } : touch, pointerId);
      this.pending = {
        gestureId: touch.gestureId, pointerId, downTime: touch.downTime ?? touch.eventTime,
        point, target: null, hit: null, hitResolved: false, occupied: false, active: false,
        cancelled: false, offset: { x: 0, y: 0 }, last: null, released: false, queuedLongPress: null,
      };
      this.emitGesture(touch, pointerId, 'start');
      return;
    }
    if (touch.action === 3) { this.cancel(touch, pointerId); return; }
    const pending = this.pending;
    if (!pending || pending.gestureId !== touch.gestureId || pending.pointerId !== pointerId) return;
    if (touch.action === 2) {
      if (!this.options.enabled()) { this.cancel(touch, pointerId); return; }
      const distance = Math.hypot(point.x - pending.point.x, point.y - pending.point.y);
      if (!pending.active && distance > MOVE_CANCEL_PX) { this.cancel(touch, pointerId); return; }
      if (pending.active) this.previewAt(pending, point);
      return;
    }
    if (touch.action === 1) {
      if (pending.active) this.previewAt(pending, point);
      if (pending.active) this.finish(true, touch, pointerId);
      else {
        pending.released = true;
        this.clearTimer();
        this.emitGesture(touch, pointerId, 'end');
        // Native emits longPress immediately after touch-up. Keep the gesture token
        // briefly so that event can be correlated without reopening a finished drag.
        this.timer = setTimeout(() => { if (this.pending === pending) this.pending = null; this.timer = null; }, 180);
      }
      return;
    }
  };

  private onHitTest: NativeMapEventHandler = (value) => {
    const hit = readHitTest(value);
    const pending = this.pending;
    if (!hit || !pending || pending.gestureId !== hit.gestureId || pending.pointerId !== hit.pointerId || pending.cancelled) return;
    if (Math.hypot(hit.point.x - pending.point.x, hit.point.y - pending.point.y) > 1) return;
    if (hit.downTime !== undefined && pending.downTime !== undefined && hit.downTime !== pending.downTime) return;
    pending.hitResolved = true;
    pending.hit = hit;
    pending.occupied = this.options.occupied?.(hit) ?? hit.ids.length > 0;
    pending.target = this.options.enabled() ? this.safeResolveTarget(hit) : null;
    if (pending.released) {
      if (pending.queuedLongPress !== null) this.handleLongPress(pending.queuedLongPress);
      return;
    }
    if (!pending.target || pending.released) return;
    if (this.options.direct?.(pending.target)) this.activate(pending);
    else this.timer = setTimeout(() => { this.timer = null; if (this.pending === pending) this.activate(pending); }, HOLD_MS);
  };

  private onGestureCancel: NativeMapEventHandler = (value) => {
    if (!isRecord(value)) return;
    const gestureId = value.gestureId;
    if (typeof gestureId !== 'string' && typeof gestureId !== 'number') return;
    const pending = this.pending;
    if (!pending || pending.gestureId !== gestureId) return;
    this.cancel({ gestureId, x: pending.point.x, y: pending.point.y, pointerCount: Number(value.pointerCount) || 2, action: 3 }, pending.pointerId);
  };

  private onLongPress: NativeMapEventHandler = (value) => this.handleLongPress(value);

  private handleLongPress(value: unknown): void {
    const pending = this.pending;
    if (!pending || pending.active || pending.target || !this.options.enabled() || !this.options.onMapHold || !isRecord(value)) return;
    if (value.gestureId !== pending.gestureId || (value.pointerId !== undefined && value.pointerId !== pending.pointerId)) return;
    if (!pending.hitResolved) { pending.queuedLongPress = value; return; }
    const point = { x: number(value.x), y: number(value.y) };
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.hypot(point.x - pending.point.x, point.y - pending.point.y) > MOVE_CANCEL_PX) return;
    const coordinate = readCoordinate(value.coordinates ?? value.coordinate) ?? pending.hit?.coordinate ?? null;
    if (!coordinate || pending.occupied) return;
    this.suppressClickUntil = Date.now() + 600;
    this.options.onMapHold({ coordinate, point: pending.point });
    this.cancel({ gestureId: pending.gestureId, action: 3, x: point.x, y: point.y, pointerCount: 0 }, pending.pointerId);
  };

  private activate(pending: Pending): void {
    if (this.pending !== pending || pending.active || !pending.target || !this.options.enabled()) return;
    const anchor = targetCoordinate(pending.target);
    const projected = this.project(anchor);
    if (!projected) { this.cancel({ gestureId: pending.gestureId, action: 3, x: pending.point.x, y: pending.point.y, pointerCount: 1 }, pending.pointerId); return; }
    pending.offset = { x: projected.x - pending.point.x, y: projected.y - pending.point.y };
    pending.active = true;
    this.capturedGesture = pending.gestureId;
    this.capture(pending.gestureId, true);
    this.options.onDragBegin(pending.target);
    this.options.onDragPreview({ target: pending.target, coordinate: anchor });
  }

  private previewAt(pending: Pending, pointer: { x: number; y: number }): void {
    if (this.pending !== pending || !pending.active || !pending.target || !this.options.enabled()) return;
    pending.last = null;
    if (Math.hypot(pointer.x - pending.point.x, pointer.y - pending.point.y) < DRAG_MIN_PX) return;
    const aim = { x: pointer.x + pending.offset.x, y: pointer.y + pending.offset.y };
    const frame = this.options.client.cameraFrame(this.options.mapId);
    if (!frame || aim.x < 0 || aim.y < 0 || aim.x > frame.viewport.width / frame.cssScale || aim.y > frame.viewport.height / frame.cssScale) return;
    const coordinate = unprojectNativeLocal(this.options.client, this.options.mapId, aim);
    if (!coordinate) return;
    const snappedNode = this.options.snap?.(pending.target, aim) ?? undefined;
    pending.last = { target: pending.target, coordinate: snappedNode?.coordinate ?? coordinate, ...(snappedNode ? { snappedNode } : {}) };
    this.options.onDragPreview(pending.last);
  }

  private finish(commit: boolean, touch: NativeRawTouch, pointerId: number): void {
    const pending = this.pending;
    if (!pending) return;
    this.clearTimer();
    if (pending.active) {
      this.suppressClickUntil = Date.now() + 600;
      if (commit && pending.last && this.options.enabled()) this.options.onDragCommit(pending.last);
      this.options.onDragPreview(null);
      this.capture(pending.gestureId, false);
      this.capturedGesture = null;
    }
    this.emitGesture(touch, pointerId, commit ? 'end' : 'cancel');
    this.pending = null;
  }

  private cancel(touch: Partial<NativeRawTouch>, pointerId: number): void {
    const pending = this.pending;
    this.clearTimer();
    if (pending?.active) {
      this.options.onDragPreview(null);
      if (this.capturedGesture !== null) this.capture(this.capturedGesture, false);
      this.capturedGesture = null;
    }
    if (pending && !pending.released) this.emitGesture({ ...touch, gestureId: pending.gestureId, x: touch.x ?? pending.point.x, y: touch.y ?? pending.point.y, pointerCount: touch.pointerCount ?? 0 }, pointerId, 'cancel');
    this.pending = null;
  }

  private emitGesture(touch: Partial<NativeRawTouch>, pointerId: number, phase: NativeGestureDetail['phase']): void {
    if (touch.gestureId === undefined) return;
    const detail: NativeGestureDetail = {
      mapId: this.options.mapId, gestureId: touch.gestureId, pointerId,
      pointerCount: touch.pointerCount ?? 1, phase, x: touch.x ?? 0, y: touch.y ?? 0,
      ...(touch.eventTime === undefined ? {} : { eventTime: touch.eventTime }), source: 'native',
    };
    if (this.options.dispatchGesture) this.options.dispatchGesture(detail);
    else if (typeof document !== 'undefined' && typeof CustomEvent !== 'undefined') document.dispatchEvent(new CustomEvent(NATIVE_MAP_GESTURE_EVENT, { detail }));
  }

  private capture(gestureId: string | number, enabled: boolean): void {
    if (!this.options.client.isReady) return;
    try { this.options.client.notify(this.options.mapId, 'gestureCapture', { gestureId, enabled }); } catch { /* the native event stream remains authoritative */ }
  }

  private safeResolveTarget(hit: NativeHitTest): DragTarget | null {
    try { return this.options.resolveTarget(hit); } catch { return null; }
  }
  private project(coordinate: Coordinate): { x: number; y: number } | null {
    return projectNativeLocal(this.options.client, this.options.mapId, coordinate);
  }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }

  dispose(): void {
    this.cancel({ action: 3, pointerCount: 0 }, this.pending?.pointerId ?? 0);
    this.removers.splice(0).forEach((remove) => remove());
    this.started = false;
  }
}

function targetCoordinate(target: DragTarget): Coordinate {
  return target.kind === 'track' ? target.node.coordinate : target.coordinate;
}
function readTouch(value: unknown): NativeRawTouch | null {
  if (!isRecord(value)) return null;
  const gestureId = value.gestureId;
  const action = Number(value.action), x = number(value.x), y = number(value.y), pointerCount = Number(value.pointerCount);
  if ((typeof gestureId !== 'string' && typeof gestureId !== 'number') || !Number.isInteger(action) || ![0, 1, 2, 3, 5, 6].includes(action) ||
      !Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(pointerCount) || pointerCount < 0) return null;
  const pointers = Array.isArray(value.pointers) ? value.pointers.filter(isRecord).map((pointer) => ({ id: Number(pointer.id), x: number(pointer.x), y: number(pointer.y) })).filter((p) => Number.isInteger(p.id) && Number.isFinite(p.x) && Number.isFinite(p.y)) : [];
  return { gestureId, action, x, y, pointerCount, pointers,
    ...(Number.isFinite(Number(value.downTime)) ? { downTime: Number(value.downTime) } : {}),
    ...(Number.isFinite(Number(value.eventTime)) ? { eventTime: Number(value.eventTime) } : {}) };
}
function readHitTest(value: unknown): NativeHitTest | null {
  if (!isRecord(value) || (typeof value.gestureId !== 'string' && typeof value.gestureId !== 'number')) return null;
  const point = isRecord(value.point) ? { x: number(value.point.x), y: number(value.point.y) } : null;
  const ids = Array.isArray(value.ids) ? value.ids.filter((id): id is string => typeof id === 'string') : [];
  const coordinate = readCoordinate(value.coordinate);
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isInteger(Number(value.pointerId))) return null;
  const exactIds = Array.isArray(value.exactIds) ? value.exactIds.filter((id): id is string => typeof id === 'string') : undefined;
  return { gestureId: value.gestureId, pointerId: Number(value.pointerId), ...(Number.isFinite(Number(value.downTime)) ? { downTime: Number(value.downTime) } : {}), ...(Number.isFinite(Number(value.eventTime)) ? { eventTime: Number(value.eventTime) } : {}), point, coordinate, ids, ...(exactIds ? { exactIds } : {}) };
}
function readCoordinate(value: unknown): Coordinate | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const lon = Number(value[0]), lat = Number(value[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90 ? [lon, lat] : null;
}
function number(value: unknown): number { return typeof value === 'number' ? value : Number.NaN; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
