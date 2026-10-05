type DetailMap = {
  getZoom: () => number;
  on?: (type: 'zoom', listener: () => void) => unknown;
};

type DetailState = { zoom: number; synchronizing: boolean };
const states = new WeakMap<DetailMap, DetailState>();

/** Terrain adjusts physical zoom after a pan without emitting a zoom gesture.
 * Editing detail follows zoom events, not those ground-elevation corrections. */
function stateFor(map: DetailMap): DetailState {
  let state = states.get(map);
  if (!state) {
    state = { zoom: map.getZoom(), synchronizing: false };
    states.set(map, state);
    const current = state;
    map.on?.('zoom', () => {
      if (!current.synchronizing) current.zoom = map.getZoom();
    });
  }
  return state;
}

export function cameraDetailZoom(map: DetailMap): number {
  return stateFor(map).zoom;
}

/** A linked pane's jumpTo emits zoom even when the source only panned. Carry
 * the source's editing detail separately from its terrain-corrected camera. */
export function withCameraDetailZoom(map: DetailMap, zoom: number, apply: () => void) {
  const state = stateFor(map), wasSynchronizing = state.synchronizing;
  state.zoom = zoom;
  state.synchronizing = true;
  try { apply(); } finally { state.synchronizing = wasSynchronizing; }
}
