import type { Feature, FeatureCollection, LineString, MultiLineString } from 'geojson';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { MarkerLayoutCache } from './markerLayoutCache.ts';
import { ProjectedPathBoundsIndex, isPathRelevant } from './projectedPathBounds.ts';
import { groupMarkerQueries } from './markerQueryGroups.ts';
import { withTerrainProjectionScope } from './terrainProjectionScope.ts';
import { releaseSharedFrameMask, tryApplySharedFrameMask, type FrameMaskEntry } from './routeIconPriorityFrameMask.ts';
import {
  clipRoutePaths, markerMaskTargets, markerScreenBounds, projectRouteFeature,
  restoreRouteMask, saveRouteMask, setRouteMask,
  type Bounds, type MaskPath, type MaskTargetMetrics, type SavedMask,
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
  sourceGeometrySignatures: Map<RouteSource, Map<string, Feature>>;
  originals: Map<HTMLElement, SavedMask>;
  targetsByMarker: Map<HTMLElement, Set<HTMLElement>>;
  disposed: boolean;
  frame: number | null;
  observer: MutationObserver | null;
  flatDirty: boolean;
  onVisualChange: () => void;
  onRender: () => void;
  onSourceData: (event: { sourceId?: string }) => void;
  update: () => void;
  schedule: () => void;
  dispose: () => void;
};
type ResolvedRouteFeature = { feature: Feature; geometrySignature?: string };
type ProjectedPaths = Array<Array<[number, number]>>;
type ClippedPaths = Array<Array<[number, number]>>;
type MarkerClipCache = WeakMap<ProjectedPaths, Array<ClippedPaths | undefined>>;
const states = new WeakMap<MapLibreMap, State>();

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const finite = (n: number) => Number.isFinite(n);

function flatMercator(map: MapLibreMap): boolean {
  try {
    if (!(typeof map.getPitch === 'function' && map.getPitch() === 0 &&
      typeof map.getTerrain === 'function' && !map.getTerrain() &&
      typeof map.getProjection === 'function')) return false;
    const projection = map.getProjection();
    // MapLibre returns an absent stylesheet projection for its default Mercator.
    return !projection || projection.type === 'mercator';
  } catch { return false; }
}

/** @internal Reuses marker-local transforms and clipping for identical projected paths in one marker. */
export function clipProjectedPathForMarker(
  projected: ProjectedPaths,
  pathIndex: number,
  screenPath: Array<[number, number]>,
  localBounds: Bounds,
  localClipBounds: Bounds,
  cache: MarkerClipCache,
  boundsIndex?: ProjectedPathBoundsIndex,
): ClippedPaths {
  if (boundsIndex && !isPathRelevant(localBounds, boundsIndex.getPathBounds(projected, pathIndex))) return [];
  let clippedByPath = cache.get(projected);
  if (!clippedByPath) {
    clippedByPath = [];
    cache.set(projected, clippedByPath);
  }
  let clipped = clippedByPath[pathIndex];
  if (!clipped) {
    const localPoints = screenPath.map(([x, y]) => [x - localBounds.left, y - localBounds.top] as [number, number]);
    clipped = clipRoutePaths(localPoints, localClipBounds);
    clippedByPath[pathIndex] = clipped;
  }
  return clipped;
}

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

function currentSourceFeature(state: State, source: RouteSource, rendered: Feature): ResolvedRouteFeature {
  const candidates = state.sources.get(source)?.features ?? [];
  if (rendered.id !== undefined) {
    const withId = candidates.find((feature) => feature.id === rendered.id &&
      (feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString'));
    if (withId) return { feature: withId };
  }
  const signature = JSON.stringify(rendered.geometry);
  let signatures = state.sourceGeometrySignatures.get(source);
  if (!signatures) {
    signatures = new Map();
    for (const feature of candidates) {
      if (feature.geometry.type !== 'LineString' && feature.geometry.type !== 'MultiLineString') continue;
      const candidateSignature = JSON.stringify(feature.geometry);
      if (!signatures.has(candidateSignature)) signatures.set(candidateSignature, feature);
    }
    state.sourceGeometrySignatures.set(source, signatures);
  }
  return { feature: signatures.get(signature) ?? rendered, geometrySignature: signature };
}

/** Returns canvas-local bounds covering visible markers for mask-only route projection. */
function createState(map: MapLibreMap): State {
  const state = {} as State;
  const layoutCache = new MarkerLayoutCache((element) => {
    const visualBounds = markerScreenBounds(element);
    const targets = markerMaskTargets(element);
    return { visualBounds, targets, targetMetrics: targets.map((target) => {
      const rect = target.getBoundingClientRect();
      return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
        width: rect.width, height: rect.height, offsetWidth: target.offsetWidth, offsetHeight: target.offsetHeight };
    }) };
  });
  const cachedMarkers = new Set<HTMLElement>();
  const observedElements = new Set<Element>();
  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    for (const entry of entries) {
      const marker = entry.target.closest<HTMLElement>('.maplibregl-marker');
      if (marker) layoutCache.invalidate(marker);
    }
    if (entries.length) state.schedule();
  });
  const invalidateLayouts = () => { layoutCache.clear(); state.onVisualChange(); };
  const onContentLoad = (event: Event) => {
    const marker = (event.target as Element)?.closest?.<HTMLElement>('.maplibregl-marker');
    if (marker) { layoutCache.invalidate(marker); state.schedule(); }
  };
  const ancestorObserver = typeof MutationObserver === 'undefined' ? null : new MutationObserver(invalidateLayouts);
  state.map = map;
  state.sources = new Map();
  state.sourceGeometrySignatures = new Map();
  state.originals = new Map();
  state.targetsByMarker = new Map();
  state.disposed = false;
  state.frame = null;
  state.observer = null;
  state.flatDirty = true;
  state.update = () => withTerrainProjectionScope(map, () => {
    if (state.disposed) return;
    try {
      if (map.isStyleLoaded()) {
        for (const source of state.sources.keys())
          if (!map.getSource(source)) {
            state.sources.delete(source);
            state.sourceGeometrySignatures.delete(source);
          }
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
    for (const marker of cachedMarkers) if (!live.has(marker)) {
      layoutCache.invalidate(marker); cachedMarkers.delete(marker);
    }
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
    const markersWithLayout = [...live].map((element) => {
      // Hidden terrain-covered markers need neither route queries nor an SVG mask.
      const hidden = element.style.getPropertyValue('opacity') === '0' ||
        element.style.getPropertyValue('visibility') === 'hidden' ||
        element.classList?.contains('is-distance-hidden');
      if (hidden) return { element, bounds: null, targets: [] as HTMLElement[], targetMetrics: new Map<HTMLElement, MaskTargetMetrics>() };
      const layout = layoutCache.get(element);
      cachedMarkers.add(element);
      const targetMetrics = new Map(layout.targets.map((target, index) => [target, layout.targetMetrics[index]]));
      return { element, bounds: layout.visualBounds, targets: layout.targets, targetMetrics };
    });
    const desiredObservedElements = new Set(layoutCache.observedElements);
    for (const element of observedElements) if (!desiredObservedElements.has(element)) {
      resizeObserver?.unobserve(element); observedElements.delete(element);
    }
    for (const element of desiredObservedElements) if (!observedElements.has(element)) {
      resizeObserver?.observe(element); observedElements.add(element);
    }
    const projectedCache = new Map<Feature, Array<Array<[number, number]>>>();
    const projectedFallbackCache = new Map<string, Array<Array<[number, number]>>>();
    const boundsIndex = new ProjectedPathBoundsIndex();
    const canvasViewport = { left: 0, top: 0,
      right: map.getCanvas().clientWidth, bottom: map.getCanvas().clientHeight };
    const hitsByMarker = new Map<HTMLElement, ReturnType<MapLibreMap['queryRenderedFeatures']>>();
    let mergeQueries = false;
    try {
      if (typeof map.getProjection === 'function') {
        const projection = map.getProjection();
        mergeQueries = !projection || projection.type === 'mercator';
      }
    } catch { /* retain individual queries for unknown projections */ }
    const groups = mergeQueries ? groupMarkerQueries(markersWithLayout, viewport) :
      markersWithLayout.filter(item => item.bounds).map(item => ({ unionBounds: item.bounds!, members: [item] }));
    for (const group of groups) {
      const bounds = group.unionBounds;
      if (bounds.right <= viewport.left || bounds.left >= viewport.right ||
        bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) continue;
      const queryBounds: [[number, number], [number, number]] = [
        [bounds.left - canvasRect.left, bounds.top - canvasRect.top],
        [bounds.right - canvasRect.left, bounds.bottom - canvasRect.top],
      ];
      let hits: ReturnType<MapLibreMap['queryRenderedFeatures']> = [];
      try { hits = map.queryRenderedFeatures(queryBounds, { layers: lineLayers }); } catch { /* style can be between reloads */ }
      for (const member of group.members) hitsByMarker.set(member.element, hits);
    }
    const resolvedCache = new Map<Feature, ResolvedRouteFeature>();
    const frameMaskEntries: FrameMaskEntry[] = [];
    for (const { element, bounds, targets: currentTargets, targetMetrics } of markersWithLayout) {
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
      const hits = hitsByMarker.get(element) ?? [];
      const paths: MaskPath[] = [];
      const markerClipCache: MarkerClipCache = new WeakMap();
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
        const renderedFeature = rendered as unknown as Feature<LineString | MultiLineString>;
        let resolved = resolvedCache.get(renderedFeature);
        if (!resolved) {
          resolved = currentSourceFeature(state, source, renderedFeature);
          resolvedCache.set(renderedFeature, resolved);
        }
        const feature = resolved.feature;
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
        let projected: Array<Array<[number, number]>> | undefined;
        if (resolved.geometrySignature !== undefined) {
          projected = projectedFallbackCache.get(resolved.geometrySignature);
          if (!projected) {
            projected = projectRouteFeature(map, feature, canvasViewport);
            projectedFallbackCache.set(resolved.geometrySignature, projected);
          }
        } else {
          projected = projectedCache.get(feature);
          if (!projected) {
            projected = projectRouteFeature(map, feature, canvasViewport);
            projectedCache.set(feature, projected);
          }
        }
        for (let pathIndex = 0; pathIndex < projected.length; pathIndex++) {
          if (paths.length >= MAX_MASK_PATHS) break;
          const clippedPaths = clipProjectedPathForMarker(
            projected, pathIndex, projected[pathIndex], localBounds, localClipBounds, markerClipCache, boundsIndex);
          for (const points of clippedPaths) {
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
        const targets = new Set(currentTargets);
        for (const target of previousTargets) if (!targets.has(target)) {
          const saved = state.originals.get(target);
          if (saved) restoreRouteMask(target, saved);
          state.originals.delete(target);
        }
        for (const target of targets) {
          let saved = state.originals.get(target);
          if (!saved) { saved = saveRouteMask(target); state.originals.set(target, saved); }
          const metrics = targetMetrics.get(target);
          if (metrics) frameMaskEntries.push({ target, markerBounds: bounds, paths, metrics });
        }
        state.targetsByMarker.set(element, targets);
      }
    }
    if (!tryApplySharedFrameMask(container, canvasRect, frameMaskEntries)) {
      for (const { target, markerBounds, paths, metrics } of frameMaskEntries) {
        const saved = state.originals.get(target);
        if (saved) setRouteMask(target, saved, markerBounds, paths, metrics);
      }
      releaseSharedFrameMask(container);
    }
  });
  state.schedule = () => {
    if (state.disposed || state.frame !== null) return;
    if (typeof requestAnimationFrame === 'function') {
      state.frame = requestAnimationFrame(() => { state.frame = null; state.update(); });
    } else state.update();
  };
  // Flat route geometry changes with the camera, route tiles, styles or markers.
  // Unrelated base-tile repainting must not repeat all DOM queries and masks.
  // Terrain, pitched and non-Mercator views retain their per-render refresh.
  state.onVisualChange = () => {
    state.flatDirty = true;
    if (!flatMercator(map)) state.schedule();
  };
  state.onRender = () => {
    if (flatMercator(map) && !state.flatDirty) return;
    state.flatDirty = false;
    state.schedule();
  };
  state.onSourceData = (event) => {
    if (event.sourceId && state.sources.has(event.sourceId as RouteSource))
      state.onVisualChange();
  };
  state.dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    if (state.frame !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(state.frame);
    state.frame = null;
    state.observer?.disconnect();
    state.observer = null;
    resizeObserver?.disconnect();
    ancestorObserver?.disconnect();
    observedElements.clear(); cachedMarkers.clear(); layoutCache.clear();
    map.getContainer().removeEventListener?.('load', onContentLoad, true);
    map.getContainer().ownerDocument?.fonts?.removeEventListener('loadingdone', invalidateLayouts);
    map.off('move', state.onVisualChange);
    map.off('resize', invalidateLayouts);
    map.off('render', state.onRender);
    map.off('styledata', invalidateLayouts);
    map.off('sourcedata', state.onSourceData);
    map.off('remove', state.dispose);
    for (const [element, saved] of state.originals) restoreRouteMask(element, saved);
    state.originals.clear();
    state.targetsByMarker.clear();
    state.sources.clear();
    state.sourceGeometrySignatures.clear();
    try { releaseSharedFrameMask(map.getContainer()); } catch { /* map container may already be detached */ }
    states.delete(map);
  };
  map.on('move', state.onVisualChange);
  map.on('resize', invalidateLayouts);
  map.on('render', state.onRender);
  map.on('styledata', invalidateLayouts);
  map.on('sourcedata', state.onSourceData);
  map.on('remove', state.dispose);
  map.getContainer().addEventListener?.('load', onContentLoad, true);
  map.getContainer().ownerDocument?.fonts?.addEventListener('loadingdone', invalidateLayouts);
  if (typeof MutationObserver !== 'undefined') {
    const container = map.getContainer();
    state.observer = new MutationObserver((records) => {
      let markerChanged = false;
      for (const record of records) {
        if (record.type === 'childList') { layoutCache.clear(); markerChanged = true; continue; }
        const target = record.target as HTMLElement;
        // MapLibre repeats classList.remove on every marker opacity check, even
        // when the marker was already uncovered. These are not layout changes.
        if (record.attributeName && record.oldValue !== undefined &&
          target.getAttribute?.(record.attributeName) === record.oldValue) continue;
        const marker = target.closest?.<HTMLElement>('.maplibregl-marker');
        if (marker) {
          if (record.attributeName !== 'style') { layoutCache.invalidate(marker); markerChanged = true; continue; }
          const current = nonMaskStyleSignature(target.getAttribute('style'));
          const previous = nonMaskStyleSignature(record.oldValue);
          if (current === previous) continue;
          // Root movement is a pure translation; rotation/scale are checked by the cache.
          // Descendant transforms, custom scale variables and all other styles affect layout.
          const layoutStyle = (value: string) => value.split(';').filter(declaration =>
            !/^(transform|opacity):/.test(declaration)).join('; ');
          if (target !== marker || layoutStyle(current) !== layoutStyle(previous)) layoutCache.invalidate(marker);
          markerChanged = true;
        } else if (target.contains?.(map.getContainer())) {
          layoutCache.clear(); markerChanged = true;
        }
      }
      if (markerChanged) state.schedule();
    });
    state.observer.observe(container, {
      subtree: true, childList: true, attributes: true,
      attributeOldValue: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'data-presentation', 'src', 'width', 'height', 'viewBox', 'd', 'fill'],
    });
    for (let ancestor = container.parentElement; ancestor; ancestor = ancestor.parentElement)
      ancestorObserver?.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style'] });
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
  if (data.features.some((feature) => feature.geometry.type === 'LineString' || feature.geometry.type === 'MultiLineString')) {
    state.sources.set(source, data);
    state.sourceGeometrySignatures.delete(source);
  } else {
    state.sources.delete(source);
    state.sourceGeometrySignatures.delete(source);
  }
  if (!state.sources.size) {
    state.dispose();
    return;
  }
  state.flatDirty = true;
  state.schedule();
}
