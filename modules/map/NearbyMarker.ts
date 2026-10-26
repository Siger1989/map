import { Marker as MapLibreMarker } from 'maplibre-gl';
import type { LngLatLike, Map as MapLibreMap } from 'maplibre-gl';
import {
  getNearbyMarkerRange, isCoordinateWithinNearbyRange,
  type NearbyMarkerRange,
} from './nearbyMarkerRange.ts';

const managers = new WeakMap<MapLibreMap, NearbyMarkerManager>();
const MIN_GESTURE_RETENTION_METERS = 30_000;
type ActiveGesture = 'touch' | 'zoom' | 'rotate';

class NearbyMarkerManager {
  readonly markers = new Set<NearbyMarker>();
  readonly map: MapLibreMap;
  private range: NearbyMarkerRange | null;
  private readonly activeGestures = new Set<ActiveGesture>();
  private disposed = false;
  private readonly onUpdate = () => this.update();
  private readonly onMoveStart = (event: { originalEvent?: unknown }) => {
    const touches = (event.originalEvent as { touches?: { length?: number } } | undefined)?.touches?.length ?? 0;
    if (touches >= 2) this.activeGestures.add('touch');
  };
  private readonly onZoomStart = () => this.activeGestures.add('zoom');
  private readonly onZoomEnd = () => this.onGestureEnd('zoom');
  private readonly onRotateStart = () => this.activeGestures.add('rotate');
  private readonly onRotateEnd = () => this.onGestureEnd('rotate');
  private readonly onMoveEnd = () => {
    this.activeGestures.clear();
    this.update();
  };
  private readonly onGestureEnd = (gesture: ActiveGesture) => {
    if (this.activeGestures.delete(gesture) && !this.activeGestures.size) this.update();
  };
  private readonly onRemove = () => this.dispose();

  constructor(map: MapLibreMap) {
    this.map = map;
    // Register before the first native Marker.addTo() installs Marker._update.
    map.on('move', this.onUpdate);
    map.on('movestart', this.onMoveStart);
    map.on('moveend', this.onMoveEnd);
    map.on('zoomstart', this.onZoomStart);
    map.on('zoomend', this.onZoomEnd);
    map.on('rotatestart', this.onRotateStart);
    map.on('rotateend', this.onRotateEnd);
    map.on('resize', this.onUpdate);
    map.on('terrain', this.onUpdate);
    map.on('projectiontransition', this.onUpdate);
    map.on('remove', this.onRemove);
    this.range = getNearbyMarkerRange(map);
  }

  add(marker: NearbyMarker) {
    this.markers.add(marker);
    marker.setNearbyManager(this, this.map);
    marker.syncNearbyState(this.range);
  }

  remove(marker: NearbyMarker) {
    if (!this.markers.delete(marker)) return;
    marker.detachFromNearbyManager(this);
    if (!this.markers.size) this.dispose();
  }

  currentRanges() {
    this.range = getNearbyMarkerRange(this.map);
    const retentionRange = this.activeGestures.size && this.range
      ? {
        ...this.range,
        enterRadiusMeters: Math.max(MIN_GESTURE_RETENTION_METERS, this.range.exitRadiusMeters),
        exitRadiusMeters: Math.max(MIN_GESTURE_RETENTION_METERS, this.range.exitRadiusMeters),
      }
      : null;
    return { range: this.range, retentionRange };
  }

  update() {
    if (this.disposed) return;
    const { range, retentionRange } = this.currentRanges();
    for (const marker of [...this.markers])
      if (this.markers.has(marker)) marker.syncNearbyState(range, retentionRange);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.map.off('move', this.onUpdate);
    this.map.off('movestart', this.onMoveStart);
    this.map.off('moveend', this.onMoveEnd);
    this.map.off('zoomstart', this.onZoomStart);
    this.map.off('zoomend', this.onZoomEnd);
    this.map.off('rotatestart', this.onRotateStart);
    this.map.off('rotateend', this.onRotateEnd);
    this.map.off('resize', this.onUpdate);
    this.map.off('terrain', this.onUpdate);
    this.map.off('projectiontransition', this.onUpdate);
    this.map.off('remove', this.onRemove);
    this.activeGestures.clear();
    for (const marker of [...this.markers]) marker.nearbyMapRemoved(this);
    this.markers.clear();
    managers.delete(this.map);
  }
}

function managerFor(map: MapLibreMap) {
  let manager = managers.get(map);
  if (!manager) {
    manager = new NearbyMarkerManager(map);
    managers.set(map, manager);
  }
  return manager;
}

/** A MapLibre marker that stays detached until it is close enough to the current map view. */
export class NearbyMarker extends MapLibreMarker {
  private nearbyManager: NearbyMarkerManager | null = null;
  private nearbyMap: MapLibreMap | null = null;
  private nativeAttached = false;
  private internalNativeLifecycle = false;

  constructor(options?: ConstructorParameters<typeof MapLibreMarker>[0]) {
    super(options);
  }

  override addTo(map: MapLibreMap): this {
    if (this.nearbyMap && this.nearbyMap !== map) this.remove();
    managerFor(map).add(this);
    return this;
  }

  override remove(): this {
    if (this.internalNativeLifecycle) {
      super.remove();
      this.nativeAttached = false;
      return this;
    }
    const manager = this.nearbyManager;
    if (manager) manager.remove(this);
    else this.detachNative();
    this.nearbyManager = null;
    this.nearbyMap = null;
    return this;
  }

  override setLngLat(lnglat: LngLatLike): this {
    const manager = this.nearbyManager;
    const ranges = manager?.currentRanges();
    if (manager && this.nativeAttached &&
      !isCoordinateWithinNearbyRange(ranges?.retentionRange ?? ranges?.range ?? null, lnglat, true)) this.detachNative();
    super.setLngLat(lnglat);
    if (manager && ranges) this.syncNearbyState(ranges.range, ranges.retentionRange);
    return this;
  }

  /** @internal Called by the per-map manager. */
  setNearbyManager(manager: NearbyMarkerManager, map: MapLibreMap) {
    this.nearbyManager = manager;
    this.nearbyMap = map;
  }

  /** @internal Called by the per-map manager. */
  syncNearbyState(range: NearbyMarkerRange | null, gestureRange: NearbyMarkerRange | null = null) {
    if (!this.nearbyMap || !this.nearbyManager) return;
    const coordinate = this.getLngLat();
    if (!coordinate) return;
    if (isCoordinateWithinNearbyRange(range, coordinate, this.nativeAttached)) {
      if (!this.nativeAttached) this.attachNative();
    } else if (this.nativeAttached && gestureRange &&
      isCoordinateWithinNearbyRange(gestureRange, coordinate, true)) {
      // Keep mounted markers through pinch/rotation jitter, using at least 30km
      // or the current viewport range; moveend applies the normal range again.
      return;
    } else if (this.nativeAttached) this.detachNative();
  }

  /** @internal Called by the per-map manager. */
  detachFromNearbyManager(manager: NearbyMarkerManager) {
    if (this.nearbyManager !== manager) return;
    this.detachNative();
    this.nearbyManager = null;
    this.nearbyMap = null;
  }

  /** @internal Called by Map.remove cleanup. */
  nearbyMapRemoved(manager: NearbyMarkerManager) {
    if (this.nearbyManager !== manager) return;
    this.detachNative();
    this.nearbyManager = null;
    this.nearbyMap = null;
  }

  private attachNative() {
    const map = this.nearbyMap;
    if (!map || this.nativeAttached) return;
    this.internalNativeLifecycle = true;
    try {
      super.addTo(map);
      this.nativeAttached = true;
    } finally { this.internalNativeLifecycle = false; }
  }

  private detachNative() {
    if (!this.nativeAttached) return;
    this.internalNativeLifecycle = true;
    try { super.remove(); }
    finally {
      this.nativeAttached = false;
      this.internalNativeLifecycle = false;
    }
  }
}
