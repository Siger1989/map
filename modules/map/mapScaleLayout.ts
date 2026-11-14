/** Main-map scales live below the actual 3D/box-selection rail. Comparison
 * maps keep their independent lower-left scale and 72px sampling span. */
export const MAIN_MAP_SCALE_WIDTH = 44;
export const COMPARISON_MAP_SCALE_WIDTH = 72;
const comparisonClasses = ['map-comparison-primary', 'map-comparison-secondary'];
export function mapScaleMaxWidth(map: Pick<Element, 'classList'>): number {
  return comparisonClasses.some(name => map.classList.contains(name)) ? COMPARISON_MAP_SCALE_WIDTH : MAIN_MAP_SCALE_WIDTH;
}

type Rect = { left: number; right: number; top: number; bottom: number; width: number; height: number };
export function mapScalePlacement(map: Rect, actions: Rect, width: number, height: number): { top: number; right: number } | null {
  if (map.width <= 0 || map.height <= 0 || width <= 0 || height <= 0 || actions.width <= 0 || actions.height <= 0) return null;
  const sx = map.width / width, sy = map.height / height;
  return {
    top: (actions.bottom - map.top) / sy + 8,
    right: Math.max(0, (map.right - actions.right) / sx + (actions.width / sx - MAIN_MAP_SCALE_WIDTH) / 2),
  };
}

export function installMapScaleLayout(map: HTMLElement, scale: HTMLElement, onLayout?: () => void): () => void {
  if (mapScaleMaxWidth(map) !== MAIN_MAP_SCALE_WIDTH) return () => {};
  const home = map.closest<HTMLElement>('.observatory.home-map');
  if (!home) return () => {};
  let frame = 0, actions: HTMLElement | null = null;
  const update = () => {
    frame = 0;
    const nextActions = home.querySelector<HTMLElement>('.home-map-actions');
    if (actions !== nextActions) {
      if (actions) resize?.unobserve(actions);
      actions = nextActions;
      if (actions) resize?.observe(actions);
    }
    const placement = actions && getComputedStyle(actions).display !== 'none'
      ? mapScalePlacement(map.getBoundingClientRect(), actions.getBoundingClientRect(), map.clientWidth, map.clientHeight) : null;
    const available = placement ? 'true' : 'false';
    let changed = scale.dataset.scaleAnchorAvailable !== available;
    if (changed) scale.dataset.scaleAnchorAvailable = available;
    if (placement) for (const [name, value] of Object.entries(placement)) {
      const property = `--map-scale-${name}`, css = `${Math.round(value * 1000) / 1000}px`;
      if (scale.style.getPropertyValue(property) !== css) { scale.style.setProperty(property, css); changed = true; }
    }
    if (changed) onLayout?.();
  };
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
  resize?.observe(map);
  const mutation = new MutationObserver(schedule);
  mutation.observe(home, { attributes: true, attributeFilter: ['class', 'style', 'data-panel', 'data-focus-locked', 'data-comparing'], childList: true, subtree: true });
  window.addEventListener('resize', schedule);
  update();
  return () => {
    if (frame) cancelAnimationFrame(frame);
    resize?.disconnect(); mutation.disconnect();
    window.removeEventListener('resize', schedule);
  };
}
