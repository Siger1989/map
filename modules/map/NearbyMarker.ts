import { Marker as MapLibreMarker } from 'maplibre-gl';
import type { LngLatLike, Map as MapLibreMap } from 'maplibre-gl';
import {
  getNearbyMarkerRange, isCoordinateWithinNearbyRange,
  type NearbyMarkerRange,
} from './nearbyMarkerRange.ts';

const managers = new WeakMap<MapLibreMap, NearbyMarkerManager>();

class NearbyMarkerManager {
  readonly markers = new Set<NearbyMarker>();
  readonly map: MapLibreMap;
  private range: NearbyMarkerRange | null;
  private disposed = false;
  private readonly onUpdate = () => this.update();
  private readonly onRemove = () => this.dispose();

  constructor(map: MapLibreMap) {
    this.map = map;
    // Register before the first native Marker.addTo() installs Marker._update.
    map.on('move', this.onUpdate);
    map.on('moveend', this.onUpdate);
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

  currentRange() {
    this.range = getNearbyMarkerRange(this.map);
    return this.range;
  }

  update() {
    if (this.disposed) return;
    this.range = getNearbyMarkerRange(this.map);
    for (const marker of [...this.markers])
      if (this.markers.has(marker)) marker.syncNearbyState(this.range);
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.map.off('move', this.onUpdate);
    this.map.off('moveend', this.onUpdate);
    this.map.off('resize', this.onUpdate);
    this.map.off('terrain', this.onUpdate);
    this.map.off('projectiontransition', this.onUpdate);
    this.map.off('remove', this.onRemove);
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
    if (manager && this.nativeAttached &&
      !isCoordinateWithinNearbyRange(manager.currentRange(), lnglat, true)) this.detachNative();
    super.setLngLat(lnglat);
    if (manager) this.syncNearbyState(manager.currentRange());
    return this;
  }

  /** @internal Called by the per-map manager. */
  setNearbyManager(manager: NearbyMarkerManager, map: MapLibreMap) {
    this.nearbyManager = manager;
    this.nearbyMap = map;
  }

  /** @internal Called by the per-map manager. */
  syncNearbyState(range: NearbyMarkerRange | null) {
    if (!this.nearbyMap || !this.nearbyManager) return;
    const coordinate = this.getLngLat();
    if (!coordinate) return;
    if (isCoordinateWithinNearbyRange(range, coordinate, this.nativeAttached)) {
      if (!this.nativeAttached) this.attachNative();
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
