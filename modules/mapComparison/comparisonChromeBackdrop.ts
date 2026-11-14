/** Decorative edge pixels only: never changes either map's projection or input box. */
export type ChromeRect = { left: number; top: number; right: number; bottom: number };
export const COMPARISON_CHROME_SELECTOR = '.map-comparison-heading,.map-comparison-toolbar,.map-comparison-actions';

export function comparisonChromeSlices(bar: ChromeRect, maps: ChromeRect[], kind: 'heading' | 'toolbar' | 'actions', pane = 0) {
  const landscape = maps.length === 2 && maps[1].left >= maps[0].right - 1;
  const indices = kind === 'toolbar' ? [pane] : landscape ? [0, 1] : [kind === 'heading' ? 0 : 1];
  return indices.flatMap(index => {
    const map = maps[index];
    if (!map || map.right <= map.left || map.bottom <= map.top) return [];
    // DOMRect edges are prototype accessors, not enumerable own properties.
    const rect = { top: bar.top, bottom: bar.bottom, left: Math.max(bar.left, map.left), right: Math.min(bar.right, map.right) };
    return rect.right > rect.left && rect.bottom > rect.top ? [{ index, rect }] : [];
  });
}

export function comparisonChromeSources(element: HTMLElement) {
  if (!element.matches(COMPARISON_CHROME_SELECTOR)) return [];
  const root = element.closest<HTMLElement>('.observatory.home-map[data-comparing="true"]');
  if (!root) return [];
  const maps = [root.querySelector<HTMLElement>('.map-comparison-primary'), root.querySelector<HTMLElement>('.map-comparison-secondary')];
  if (!maps[0] || !maps[1]) return [];
  const kind = element.matches('.map-comparison-heading') ? 'heading' : element.matches('.map-comparison-actions') ? 'actions' : 'toolbar';
  const pane = Array.from(root.querySelectorAll('.map-comparison-pane')).indexOf(element.closest('.map-comparison-pane')!);
  return comparisonChromeSlices(element.getBoundingClientRect(), maps.map(map => map!.getBoundingClientRect()), kind, pane)
    .map(slice => ({ ...slice, map: maps[slice.index]! }));
}

type RenderMap = { getCanvas(): HTMLCanvasElement; on(type: 'render', callback: () => void): unknown;
  off(type: 'render', callback: () => void): unknown; triggerRepaint(): void };

/** Read the already rendered WebGL canvas synchronously before its drawing buffer
 * is discarded. No second renderer, screenshot transport or animation loop. */
export function installComparisonChromeBackdrop(map: RenderMap, host: HTMLElement): () => void {
  const root = host.closest<HTMLElement>('.observatory.home-map');
  if (!root) return () => {};
  let canvas: HTMLCanvasElement | null = null, last = -Infinity, pending: ReturnType<typeof setTimeout> | undefined;
  const remove = () => { canvas?.remove(); canvas = null; };
  const render = () => {
    if (root.dataset.comparing !== 'true') { remove(); return; }
    const now = performance.now();
    if (now - last < 100) {
      // A final movement frame still reaches the decoration after throttling.
      pending ??= setTimeout(() => { pending = undefined; map.triggerRepaint(); }, Math.ceil(100 - (now - last)));
      return;
    }
    if (pending !== undefined) { clearTimeout(pending); pending = undefined; }
    const ui = root.querySelector<HTMLElement>('.map-comparison-ui');
    if (!ui) return;
    const source = map.getCanvas();
    const mapRect = source.getBoundingClientRect(), uiRect = ui.getBoundingClientRect();
    if (!source.width || !source.height || !mapRect.width || !uiRect.width || !uiRect.height) return;
    if (!canvas || canvas.parentElement !== ui) {
      remove(); canvas = document.createElement('canvas');
      canvas.className = 'map-comparison-chrome-backdrop'; canvas.setAttribute('aria-hidden', 'true');
      ui.insertBefore(canvas, ui.firstChild);
    }
    // At most 512px on the longest axis, including large desktop previews.
    const scale = Math.min(1, 512 / Math.max(uiRect.width, uiRect.height));
    const width = Math.max(1, Math.round(uiRect.width * scale)), height = Math.max(1, Math.round(uiRect.height * scale));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const bars = ui.querySelectorAll<HTMLElement>(COMPARISON_CHROME_SELECTOR);
    for (const bar of bars) {
      for (const { rect, map: owner } of comparisonChromeSources(bar)) {
        if (owner !== host) continue;
        const sx = (rect.left - mapRect.left) / mapRect.width * source.width;
        const sw = (rect.right - rect.left) / mapRect.width * source.width;
        const sy = rect.bottom <= mapRect.top + 1 ? 0 : source.height - 1;
        try {
          context.drawImage(source, sx, sy, sw, 1, (rect.left - uiRect.left) * scale,
            (rect.top - uiRect.top) * scale, (rect.right - rect.left) * scale, (rect.bottom - rect.top) * scale);
        } catch {
          // A lost WebGL context or unavailable frame must never interrupt the
          // map render callback. A later real frame retries the decoration.
          context.clearRect(0, 0, width, height);
          last = now;
          return;
        }
      }
    }
    last = now;
  };
  const refresh = () => { last = -Infinity; map.triggerRepaint(); };
  const mutation = new MutationObserver(() => {
    if (root.dataset.comparing !== 'true') remove();
    refresh();
  });
  mutation.observe(root, { attributes: true, attributeFilter: ['data-comparing'] });
  const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(refresh) : null;
  resize?.observe(root); resize?.observe(host);
  map.on('render', render);
  return () => { map.off('render', render); mutation.disconnect(); resize?.disconnect(); clearTimeout(pending); remove(); };
}
