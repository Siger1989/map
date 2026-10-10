import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  clipRoutePaths, markerMaskTargets, markerScreenBounds, projectRouteFeature,
  restoreRouteMask, saveRouteMask, setRouteMask,
  type Bounds, type MaskPath, type SavedMask,
} from './routeIconPriorityGeometry.ts';

type RouteSource = 'planned-route' | 'manual-tracks' | 'manual-track-selection-edge' | 'route-guidance' | 'route-gap';
type RouteLayerId =
  | 'route-outline' | 'route-path' | 'route-access'
  | 'manual-track-outline' | 'manual-track-line'
  | 'manual-track-selection-edge'
  | 'guidance-outline' | 'guidance-path' | 'guidance-access'
  | 'route-gap-line';
const layersBySource: Record<RouteSource, readonly RouteLayerId[]> = {
  'planned-route': ['route-outline', 'route-path', 'route-access'],
  'manual-tracks': ['manual-track-outline', 'manual-track-line'],
  'manual-track-selection-edge': ['manual-track-selection-edge'],
  'route-guidance': ['guidance-outline', 'guidance-path', 'guidance-access'],
  'route-gap': ['route-gap-line'],
};
const maskProperties = [
  'mask-image', '-webkit-mask-image', 'mask-size', '-webkit-mask-size',
  'mask-position', '-webkit-mask-position', 'mask-repeat', '-webkit-mask-repeat',
  'mask-mode', '-webkit-mask-mode', 'mask-origin', '-webkit-mask-origin',
  'mask-clip', '-webkit-mask-clip',
] as const;
const maskPropertySet = new Set<string>(maskProperties);
const MAX_MASK_PATHS = 48;
type State = {
  map: MapLibreMap;
  sources: Map<RouteSource, FeatureCollection>;
  originals: Map<HTMLElement, SavedMask>;
  targetsByMarker: Map<HTMLElement, Set<HTMLElement>>;
  disposed: boolean;
  frame: number | null;
  observer: MutationObserver | null;
  update: () => void;
  schedule: () => void;
  dispose: () => void;
};
const states = new WeakMap<MapLibreMap, State>();

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const finite = (n: number) => Number.isFinite(n);

function nonMaskStyleSignature(styleText: string | null): string {
  if (!styleText) return '';
  const declarations: string[] = [];
  let start = 0, quote = '', depth = 0;
  for (let i = 0; i <= styleText.length; i++) {
    const char = styleText[i] ?? ';';
    if (quote) {
      if (char === quote && styleText[i - 1] !== '\\') quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(') depth++;
    else if (char === ')') depth = Math.max(0, depth - 1);
    else if (char === ';' && depth === 0) {
      const declaration = styleText.slice(start, i).trim();
      start = i + 1;
      if (!declaration) continue;
      const separator = declaration.indexOf(':');
      if (separator < 1) continue;
      const property = declaration.slice(0, separator).trim().toLowerCase();
      if (!maskPropertySet.has(property))
        declarations.push(`${property}:${declaration.slice(separator + 1).trim()}`);
    }
  }
  return declarations.sort().join(';');
}

function evaluate(expression: unknown, properties: Record<string, unknown>): number | boolean | null {
  if (typeof expression === 'number' || typeof expression === 'boolean') return expression;
  if (!Array.isArray(expression) || !expression.length) return null;
  const [op, ...args] = expression;
  if (op === 'get' && typeof args[0] === 'string') {
    const value = properties[args[0]];
    return typeof value === 'number' || typeof value === 'boolean' ? value : null;
  }
  if (op === 'coalesce') {
    for (const item of args) {
      const value = evaluate(item, properties);
      if (value !== null) return value;
    }
    return null;
  }
  if (op === 'case') {
    for (let i = 0; i + 1 < args.length - 1; i += 2) {
      const condition = evaluate(args[i], properties);
      if (condition === true) return evaluate(args[i + 1], properties);
    }
    return evaluate(args.at(-1), properties);
  }
  if (op === '==' || op === '!=') {
    const a = evaluate(args[0], properties), b = evaluate(args[1], properties);
    return op === '==' ? a === b : a !== b;
  }
  if (op === '*' || op === '+') {
    const a = evaluate(args[0], properties), b = evaluate(args[1], properties);
    if (typeof a !== 'number' || typeof b !== 'number') return null;
    return op === '*' ? a * b : a + b;
  }
  return null;
}

function paintNumber(map: MapLibreMap, layer: RouteLayerId, property: string, feature: Feature, fallback: number) {
  const style = map.getPaintProperty(layer, property as never);
  const result = evaluate(style, (feature.properties ?? {}) as Record<string, unknown>);
  return typeof result === 'number' && finite(result) ? result : fallback;
}

function candidateLayers(map: MapLibreMap): RouteLayerId[] {
  const output: RouteLayerId[] = [];
  for (const ids of Object.values(layersBySource)) for (const id of ids) {
    const layer = map.getLayer(id);
    if (!layer) continue;
    const visibility = map.getLayoutProperty(id, 'visibility' as never) as unknown;
    if (visibility !== 'none') output.push(id);
  }
  return output;
}

function sourceForLayer(layer: RouteLayerId): RouteSource {
  for (const [source, ids] of Object.entries(layersBySource)) if (ids.includes(layer)) return source as RouteSource;
  return 'planned-route';
}

function currentSourceFeature(state: State, source: RouteSource, rendered: Feature): Feature {
  const candidates = state.sources.get(source)?.features ?? [];
  if (rendered.id !== undefined) {
    const withId = candidates.find((feature) => feature.id === rendered.id &&
      (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString'));
    if (withId) return withId;
  }
  const signature = JSON.stringify(rendered.geometry);
  return candidates.find((feature) =>
    (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString') &&
    JSON.stringify(feature.geometry) === signature) ?? rendered;
}

function createState(map: MapLibreMap): State {
  const state = {} as State;
  state.map = map;
  state.sources = new Map();
  state.originals = new Map();
  state.targetsByMarker = new Map();
  state.disposed = false;
  state.frame = null;
  state.observer = null;
  state.update = () => {
    if (state.disposed) return;
    try {
      if (map.isStyleLoaded()) {
        for (const source of state.sources.keys())
          if (!map.getSource(source)) state.sources.delete(source);
      }
    } catch { /* style is being replaced */ }
    if (!state.sources.size) { state.dispose(); return; }
    let container: HTMLElement;
    try { container = map.getContainer(); } catch { return; }
    const canvasRect = map.getCanvas().getBoundingClientRect();
    const viewport = { left: canvasRect.left, top: canvasRect.top,
      right: canvasRect.left + map.getCanvas().clientWidth,
      bottom: canvasRect.top + map.getCanvas().clientHeight };
    const live = new Set(container.querySelectorAll<HTMLElement>('.maplibregl-marker'));
    for (const [marker, targets] of state.targetsByMarker) if (!live.has(marker)) {
      for (const target of targets) {
        const saved = state.originals.get(target);
        if (saved) restoreRouteMask(target, saved);
        state.originals.delete(target);
      }
      state.targetsByMarker.delete(marker);
    }
    const lineLayers = candidateLayers(map);
    if (!lineLayers.length) {
      state.dispose();
      return;
    }
    const projectedCache = new Map<string, Array<Array<[number, number]>>>();
    const canvasViewport = { left: 0, top: 0,
      right: map.getCanvas().clientWidth, bottom: map.getCanvas().clientHeight };
    for (const element of live) {
      const bounds = markerScreenBounds(element);
      if (!bounds || bounds.right <= viewport.left || bounds.left >= viewport.right ||
        bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) {
        const previousTargets = state.targetsByMarker.get(element) ?? [];
        for (const target of previousTargets) {
          const saved = state.originals.get(target);
          if (saved) restoreRouteMask(target, saved);
          state.originals.delete(target);
        }
        state.targetsByMarker.delete(element);
        continue;
      }
      const queryBounds: [[number, number], [number, number]] = [
        [bounds.left - canvasRect.left, bounds.top - canvasRect.top],
        [bounds.right - canvasRect.left, bounds.bottom - canvasRect.top],
      ];
      let hits: ReturnType<MapLibreMap['queryRenderedFeatures']> = [];
      try { hits = map.queryRenderedFeatures(queryBounds, { layers: lineLayers }); } catch { /* style can be between reloads */ }
      const paths: MaskPath[] = [];
      const localBounds = { left: bounds.left - canvasRect.left, top: bounds.top - canvasRect.top,
        right: bounds.right - canvasRect.left, bottom: bounds.bottom - canvasRect.top };
      const localClipBounds = { left: 0, top: 0,
        right: localBounds.right - localBounds.left,
        bottom: localBounds.bottom - localBounds.top };
      for (const rendered of hits) {
        const layer = rendered.layer?.id as RouteLayerId;
        const source = sourceForLayer(layer);
        if (!lineLayers.includes(layer) || !state.sources.has(source)) continue;
        if (rendered.source && rendered.source !== source) continue;
        const feature = currentSourceFeature(state, source, rendered as unknown as Feature<LineString | MultiLineString>) as Feature;
        if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') continue;
        const props = (feature.properties ?? {}) as Record<string, unknown>;
        const opacity = paintNumber(map, layer, 'line-opacity', feature, 1);
        if (opacity <= 0 || props.opacity === 0) continue;
        const width = Math.max(0, paintNumber(map, layer, 'line-width', feature, 4));
        if (!width) continue;
        const capValue = map.getLayoutProperty(layer, 'line-cap' as never);
        const cap = capValue === 'round' || capValue === 'square' ? capValue : 'butt';
        const dash = map.getPaintProperty(layer, 'line-dasharray' as never) as unknown;
        const dashValue = Array.isArray(dash) && dash.every((v) => typeof v === 'number') ? dash as number[] : [];
        const key = `${source}:${feature.id ?? ''}:${JSON.stringify(feature.geometry)}`;
        let projected = projectedCache.get(key);
        if (!projected) {
          projected = projectRouteFeature(map, feature, canvasViewport);
          projectedCache.set(key, projected);
        }
        for (const screenPath of projected) {
          const localPoints = screenPath.map(([x, y]) => [x - localBounds.left, y - localBounds.top] as [number, number]);
          for (const points of clipRoutePaths(localPoints, localClipBounds)) {
            if (paths.length >= MAX_MASK_PATHS) break;
            paths.push({ points, width, dash: dashValue, cap });
          }
        }
        if (paths.length >= MAX_MASK_PATHS) break;
      }
      const previousTargets = state.targetsByMarker.get(element) ?? new Set<HTMLElement>();
      if (!paths.length) {
        for (const target of previousTargets) {
          const saved = state.originals.get(target);
          if (saved) restoreRouteMask(target, saved);
          state.originals.delete(target);
        }
        state.targetsByMarker.delete(element);
      } else {
        const targets = new Set(markerMaskTargets(element));
        for (const target of previousTargets) if (!targets.has(target)) {
          const saved = state.originals.get(target);
          if (saved) restoreRouteMask(target, saved);
          state.originals.delete(target);
        }
        for (const target of targets) {
          let saved = state.originals.get(target);
          if (!saved) { saved = saveRouteMask(target); state.originals.set(target, saved); }
          setRouteMask(target, saved, bounds, paths);
        }
        state.targetsByMarker.set(element, targets);
      }
    }
  };
  state.schedule = () => {
    if (state.disposed || state.frame !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      state.frame = requestAnimationFrame(() => { state.frame = null; state.update(); });
    } else state.update();
  };
  state.dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    if (state.frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.frame);
    state.frame = null;
    state.observer?.disconnect();
    state.observer = null;
    map.off('move', state.schedule);
    map.off('resize', state.schedule);
    map.off('render', state.schedule);
    map.off('styledata', state.schedule);
    map.off('remove', state.dispose);
    for (const [element, saved] of state.originals) restoreRouteMask(element, saved);
    state.originals.clear();
    state.targetsByMarker.clear();
    state.sources.clear();
    states.delete(map);
  };
  map.on('move', state.schedule);
  map.on('resize', state.schedule);
  map.on('render', state.schedule);
  map.on('styledata', state.schedule);
  map.on('remove', state.dispose);
  if (typeof MutationObserver !== 'undefined') {
    const container = map.getContainer();
    state.observer = new MutationObserver((records) => {
      const markerChanged = records.some((record) => {
        if (record.type === 'childList') return true;
        const target = record.target as HTMLElement;
        if (target.closest?.('.maplibregl-marker')) {
          if (record.attributeName !== 'style') return true;
          return nonMaskStyleSignature(target.getAttribute('style')) !==
            nonMaskStyleSignature(record.oldValue);
        }
        return false;
      });
      if (markerChanged) state.schedule();
    });
    state.observer.observe(container, {
      subtree: true, childList: true, attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'data-presentation'],
    });
  }
  return state;
}

/**
 * Reconcile route strokes with map-attached DOM markers for one map instance.
 * The marker remains interactive; only pixels occupied by visible route strokes
 * become transparent so the original terrain-draped WebGL line shows through.
 */
export function syncRouteIconPriority(map: MapLibreMap, sourceId: string, data: FeatureCollection) {
  if (!(sourceId in layersBySource)) return;
  let state = states.get(map);
  if (!state) { state = createState(map); states.set(map, state); }
  const source = sourceId as RouteSource;
  if (data.features.some((feature) => feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString'))
    state.sources.set(source, data);
  else state.sources.delete(source);
  if (!state.sources.size) {
    state.dispose();
    return;
  }
  state.schedule();
}
