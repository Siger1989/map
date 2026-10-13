import { MercatorCoordinate, type Map as MapLibreMap } from 'maplibre-gl';

type TerrainLike = {
  exaggeration: number;
  getCoverageIndex: (...args: unknown[]) => unknown;
  getElevationForLngLat: (...args: unknown[]) => number;
  getElevationForLngLatZoom: (...args: unknown[]) => number;
};
type MethodName = 'getElevationForLngLat' | 'getElevationForLngLatZoom';
type CoverageIndexLike = { zooms: number[]; samplerPerTile: Map<string, unknown> };
type MethodRestore = () => void;
const activeTerrains = new WeakSet<object>();

function installMethod(terrain: object, key: MethodName, value: Function): MethodRestore | null {
  const ownDescriptor = Object.getOwnPropertyDescriptor(terrain, key);
  if (ownDescriptor ? !ownDescriptor.configurable : !Object.isExtensible(terrain)) return null;
  try {
    Object.defineProperty(terrain, key, {
      configurable: true,
      enumerable: ownDescriptor?.enumerable ?? false,
      writable: true,
      value,
    });
  } catch {
    return null;
  }
  return () => {
    if (ownDescriptor) Object.defineProperty(terrain, key, ownDescriptor);
    else Reflect.deleteProperty(terrain, key);
  };
}

/** Shares fallback terrain zoom decisions only during one synchronous map update. */
export function withTerrainProjectionScope<T>(map: MapLibreMap, callback: () => T): T {
  let terrain: TerrainLike | null | undefined;
  try {
    terrain = (map as MapLibreMap & { terrain?: TerrainLike | null }).terrain;
  } catch {
    return callback();
  }
  if (!terrain || activeTerrains.has(terrain) ||
    typeof terrain.getCoverageIndex !== 'function' ||
    typeof terrain.getElevationForLngLat !== 'function' ||
    typeof terrain.getElevationForLngLatZoom !== 'function') return callback();

  const originalElevation = terrain.getElevationForLngLat;
  const originalElevationAtZoom = terrain.getElevationForLngLatZoom;
  const zoomByTransform = new WeakMap<object, number>();
  let captureTransform: object | null = null;
  let capturedZoom: number | undefined;

  const elevationAtZoom = function (this: unknown, ...args: unknown[]) {
    const result = Reflect.apply(originalElevationAtZoom, this, args);
    if (captureTransform && typeof args[1] === 'number') capturedZoom = args[1];
    return result;
  };
  const elevation = function (this: unknown, ...args: unknown[]) {
    const lngLat = args[0];
    const transform = args[1];
    let index: unknown;
    try {
      index = Reflect.apply(terrain!.getCoverageIndex, terrain, []);
    } catch {
      return Reflect.apply(originalElevation, this, args);
    }

    let loaded: boolean | null = null;
    if (index === null) loaded = false;
    else if (index && typeof index === 'object') {
      const candidate = index as Partial<CoverageIndexLike>;
      if (Array.isArray(candidate.zooms) && candidate.zooms.every(Number.isInteger) &&
        candidate.samplerPerTile && typeof candidate.samplerPerTile.has === 'function' &&
        typeof candidate.samplerPerTile.get === 'function' && lngLat != null) {
        try {
          const mercator = MercatorCoordinate.fromLngLat(lngLat as never);
          const x = mercator.x, y = mercator.y;
          if (y < 0 || y >= 1) loaded = false;
          else {
            const wrap = Math.floor(x);
            const wrappedX = x - wrap;
            loaded = false;
            for (const zoom of candidate.zooms) {
              const scale = 1 << zoom;
              const tileX = Math.floor(wrappedX * scale);
              const tileY = Math.floor(y * scale);
              const key = `${wrap}/${zoom}/${tileX}/${tileY}`;
              if (!candidate.samplerPerTile.has(key)) continue;
              const sampler = candidate.samplerPerTile.get(key);
              if (typeof sampler === 'function') loaded = true;
              else if (sampler !== null) loaded = null;
              break;
            }
          }
        } catch {
          loaded = null;
        }
      }
    }
    if (loaded !== false) return Reflect.apply(originalElevation, this, args);

    if ((typeof transform === 'object' && transform !== null) || typeof transform === 'function') {
      const transformObject = transform as object;
      const cachedZoom = zoomByTransform.get(transformObject);
      if (cachedZoom !== undefined) {
        const zoomArgs = args.slice();
        zoomArgs[1] = cachedZoom;
        return Reflect.apply(originalElevationAtZoom, this, zoomArgs);
      }
      const previousCapture = captureTransform;
      const previousZoom = capturedZoom;
      captureTransform = transformObject;
      capturedZoom = undefined;
      try {
        return Reflect.apply(originalElevation, this, args);
      } finally {
        if (capturedZoom !== undefined) zoomByTransform.set(transformObject, capturedZoom);
        captureTransform = previousCapture;
        capturedZoom = previousZoom;
      }
    }
    return Reflect.apply(originalElevation, this, args);
  };

  const restoreZoom = installMethod(terrain, 'getElevationForLngLatZoom', elevationAtZoom);
  if (!restoreZoom) return callback();
  const restoreElevation = installMethod(terrain, 'getElevationForLngLat', elevation);
  if (!restoreElevation) {
    restoreZoom();
    return callback();
  }

  activeTerrains.add(terrain);
  try {
    return callback();
  } finally {
    try {
      restoreElevation();
    } finally {
      restoreZoom();
      activeTerrains.delete(terrain);
    }
  }
}
