import type { Map } from 'maplibre-gl';

/** Bounded counters for the existing read-only map inspection tool. No pixel reads. */
export function observeMapRendering(map: Map) {
  const started = performance.now();
  const counts: Record<string, number> = {};
  const sources: Record<string, number> = {};
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
  ] as const;
  const listeners = events.map((name) => {
    const listener = (event: { type: string; sourceId?: string }) => {
      counts[name] = (counts[name] ?? 0) + 1;
      if (name === 'sourcedata' && event.sourceId)
        sources[event.sourceId] = (sources[event.sourceId] ?? 0) + 1;
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
      recent: [...recent],
      canvas: { width: map.getCanvas().width, height: map.getCanvas().height },
    }),
    dispose: () => listeners.forEach((remove) => remove()),
  };
}
