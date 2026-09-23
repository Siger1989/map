import type { Map } from 'maplibre-gl';

/** Bounded counters for the existing read-only map inspection tool. No pixel reads. */
export function observeMapRendering(map: Map) {
  const started = performance.now();
  const counts: Record<string, number> = {};
  const sources: Record<string, number> = {};
  const sourceRequests: Record<string, number> = {};
  const sourceErrors: Record<string, number> = {};
  let lastRender = started, lastMove = started, contextLost = false;
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
      if (name === 'render') lastRender = performance.now();
      if (name === 'movestart' || name === 'moveend') lastMove = performance.now();
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
          at: Math.round(performance.now() - started),
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
      elapsedMs: Math.round(performance.now() - started),
      counts: { ...counts },
      sources: { ...sources },
      sourceRequests: { ...sourceRequests },
      sourceErrors: { ...sourceErrors },
      rendering: {
        contextLost,
        sinceLastRenderMs: Math.round(performance.now() - lastRender),
        sinceLastMoveMs: Math.round(performance.now() - lastMove),
        moving: map.isMoving(),
        tilesLoaded: map.areTilesLoaded(),
        // A stationary map is allowed to stop rendering; this is evidence, not a freeze verdict.
      },
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
      canvas: { width: map.getCanvas().width, height: map.getCanvas().height },
    }),
    dispose: () => listeners.forEach((remove) => remove()),
  };
}
