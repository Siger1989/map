import type { Map } from 'maplibre-gl';

/** Bounded counters for the existing read-only map inspection tool. No pixel reads. */
export function observeMapRendering(map: Map, now: () => number = () => performance.now()) {
  const started = now();
  // Read once when attaching diagnostics, never in the render event hot path.
  const context = map.getCanvas().getContext?.('webgl2');
  const contextAttributes = context?.getContextAttributes() ?? null;
  const counts: Record<string, number> = {};
  const sources: Record<string, number> = {};
  const sourceRequests: Record<string, number> = {};
  const sourceErrors: Record<string, number> = {};
  let lastRender = started, lastMove = started, contextLost = false;
  let previousMovingRender: number | null = null;
  const movingIntervals: number[] = [];
  const recent: { event: string; at: number; source?: string }[] = [];
  const events = [
    'render',
    'idle',
    'movestart',
    'moveend',
    'resize',
    'sourcedataloading',
    'sourcedata',
    'webglcontextlost',
    'webglcontextrestored',
    'error',
  ] as const;
  const listeners = events.map((name) => {
    const listener = (event: { type: string; sourceId?: string }) => {
      counts[name] = (counts[name] ?? 0) + 1;
      if (name === 'render') {
        lastRender = now();
        if (map.isMoving() && !contextLost) {
          if (previousMovingRender !== null) {
            movingIntervals.push(lastRender - previousMovingRender);
            if (movingIntervals.length > 120) movingIntervals.shift();
          }
          previousMovingRender = lastRender;
        } else previousMovingRender = null;
      }
      if (name === 'movestart' || name === 'moveend') {
        lastMove = now();
        previousMovingRender = null;
      }
      if (name === 'webglcontextlost' || name === 'webglcontextrestored') previousMovingRender = null;
      if (name === 'webglcontextlost') contextLost = true;
      if (name === 'webglcontextrestored') contextLost = false;
      if (name === 'sourcedata' && event.sourceId)
        sources[event.sourceId] = (sources[event.sourceId] ?? 0) + 1;
      if (name === 'sourcedataloading' && event.sourceId)
        sourceRequests[event.sourceId] =
          (sourceRequests[event.sourceId] ?? 0) + 1;
      if (name === 'error' && event.sourceId)
        sourceErrors[event.sourceId] = (sourceErrors[event.sourceId] ?? 0) + 1;
      if (name !== 'render' && name !== 'sourcedata') {
        recent.push({
          event: name,
          at: Math.round(now() - started),
          source: event.sourceId,
        });
        if (recent.length > 16) recent.shift();
      }
    };
    map.on(name, listener);
    return () => map.off(name, listener);
  });
  return {
    snapshot: () => ({
      elapsedMs: Math.round(now() - started),
      counts: { ...counts },
      sources: { ...sources },
      sourceRequests: { ...sourceRequests },
      sourceErrors: { ...sourceErrors },
      rendering: {
        contextLost,
        sinceLastRenderMs: Math.round(now() - lastRender),
        sinceLastMoveMs: Math.round(now() - lastMove),
        moving: map.isMoving(),
        tilesLoaded: map.areTilesLoaded(),
        // A stationary map is allowed to stop rendering; this is evidence, not a freeze verdict.
      },
      // Render event cadence during camera motion; not a GPU execution timer.
      movingFrameIntervals: frameIntervals(movingIntervals),
      terrainSources: ['elevation', 'shading'].map(id => ({
        id, present: Boolean(map.getSource(id)),
        loaded: Boolean(map.getSource(id)) && map.isSourceLoaded(id),
        requests: sourceRequests[id] ?? 0, errors: sourceErrors[id] ?? 0,
      })),
      roads: {
        sourcePresent: Boolean(map.getSource('openmaptiles')),
        sourceLoaded: map.getSource('openmaptiles')
          ? map.isSourceLoaded('openmaptiles')
          : false,
        requests: sourceRequests.openmaptiles ?? 0,
        errors: sourceErrors.openmaptiles ?? 0,
        terrainEnabled: Boolean(map.getTerrain()),
        zoom: map.getZoom(),
        layers: ['road-outline', 'main-roads', 'local-roads'].map((id) => {
          const layer = map.getLayer(id);
          const visibility = layer
            ? (map.getLayoutProperty(id, 'visibility') ?? 'visible')
            : 'none';
          return {
            id,
            present: Boolean(layer),
            visibility,
            eligibleAtZoom:
              Boolean(layer) &&
              visibility !== 'none' &&
              map.getZoom() >= (layer?.minzoom ?? 0) &&
              map.getZoom() < (layer?.maxzoom ?? 24),
          };
        }),
      },
      recent: [...recent],
      canvas: canvasResolution(map.getCanvas()),
      contextAttributes,
    }),
    dispose: () => listeners.forEach((remove) => remove()),
  };
}

function frameIntervals(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    samples: values.length,
    averageMs: values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length * 10) / 10 : null,
    p95Ms: sorted.length ? Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1] * 10) / 10 : null,
    over50Ms: values.filter(value => value > 50).length,
  };
}

/** Report actual backing pixels, since GPU limits can lower the requested ratio. */
function canvasResolution(canvas: HTMLCanvasElement) {
  const cssWidth = canvas.clientWidth, cssHeight = canvas.clientHeight;
  return {
    width: canvas.width,
    height: canvas.height,
    cssWidth,
    cssHeight,
    devicePixelRatio: canvas.ownerDocument.defaultView?.devicePixelRatio ?? null,
    effectivePixelRatioX: cssWidth > 0 ? canvas.width / cssWidth : null,
    effectivePixelRatioY: cssHeight > 0 ? canvas.height / cssHeight : null,
  };
}
