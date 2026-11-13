const TARGETS = new Set([
  'window', 'chrome', 'controls', 'accent', 'accentText', 'text',
  'switchOff', 'knob', 'edges', 'selected',
]);

const SELECTORS = {
  window: '.control-popover, .route-surface, .route-dialog, .home-route-card, .home-journey-points, .selected-route-info, .home-map-popup, .home-recording-panel, .raster-level-panel, .route-display-settings, .marker-workspace, .pin-editor, .measurement-panel, .section-panel, .survey-panel, .trip-photo-viewer, .place-share-panel, .offline-region-actions, .offline-download-dock, .survey-workbar, .survey-dock, .object-gizmo-actions, .track-tools, .track-draw-tools, .guidance-card, .geology-panel, .area-drawing-tools, .area-editor, .direction-menu, .route-start-notice, .map-comparison-ui .layer-window, .position-status, .track-draw-hint, .favorite-source-popup',
  chrome: '.home-topbar, .control-dock > .map-toolbar, .home-map-actions, .home-position-dock, .global-focus-lock, .home-recording-toggle',
  controls: '.control-popover button, .control-popover input, .control-popover select, .control-popover textarea, .route-surface button, .route-surface input, .route-surface select, .route-surface textarea, .track-tools button, .track-tools select, .route-stop-block, .favorite-source-list > button, .favorite-source-manage',
  accent: '.control-popover button.is-primary, .control-popover button.route-primary, .control-popover button.collection-primary, .control-popover button.recording-start, .control-popover button.pin-save, .route-surface button.is-primary, .map-switch[data-checked="true"] .map-switch__track',
  selected: '.home-bottom-nav button[data-home-selected="true"], .control-popover button[aria-pressed="true"], .control-popover button[aria-selected="true"], .control-popover button.is-active, .route-surface button[aria-pressed="true"], .track-tools button[aria-pressed="true"], .home-position-dock .position-dock-button[aria-expanded="true"], .favorite-source-trigger[aria-expanded="true"], .favorite-source-list > button[aria-current="true"]',
  accentText: '.control-popover button.is-primary, .control-popover button.route-primary, .control-popover button.collection-primary, .control-popover button.recording-start, .control-popover button.pin-save, .route-surface button.is-primary',
  text: '.control-popover h1, .control-popover h2, .control-popover h3, .control-popover [role="heading"], .route-surface h1, .route-surface h2, .route-surface h3, .home-topbar h1, .home-topbar h2, .guidance-card h1, .guidance-card h2, .position-status, .track-draw-hint, .home-map-actions > button.dimension-button',
  switchOff: 'label.map-switch[data-checked="false"] .map-switch__track, label.map-switch:not([data-checked="true"]) .map-switch__track',
  knob: '.control-popover .map-switch__track > span, .route-surface .map-switch__track > span',
  edges: '.control-popover, .route-surface, .route-dialog, .home-route-card, .home-journey-points, .selected-route-info, .home-map-popup, .home-recording-panel, .raster-level-panel, .route-display-settings, .marker-workspace, .pin-editor, .measurement-panel, .section-panel, .survey-panel, .trip-photo-viewer, .place-share-panel, .offline-region-actions, .offline-download-dock, .survey-workbar, .survey-dock, .object-gizmo-actions, .track-tools, .track-draw-tools, .guidance-card, .geology-panel, .area-drawing-tools, .area-editor, .direction-menu, .route-start-notice, .map-comparison-ui .layer-window',
};

// Portals share the same editor categories as panels inside the map host.
SELECTORS.window += ', .app-color-picker, .floating-search, .place-search-results, .place-share-panel, .measurement-share, .marker-confirm, .comparison-source-popup, .map-comparison-property, .section-list, .collection-action-dialog, .workbench-share-dialog, .workbench-sort-menu';
SELECTORS.edges += ', .app-color-picker, .floating-search, .place-share-panel, .measurement-share, .comparison-source-popup, .map-comparison-property, .section-list, .collection-action-dialog, .workbench-share-dialog, .workbench-sort-menu';
SELECTORS.controls += ', .app-color-picker button, .place-share-panel button, .place-search-results button, .place-search-results input, .section-list button, .collection-action-dialog button, .collection-action-dialog input, .collection-action-dialog select, .workbench-sort-menu button';
SELECTORS.text += ', .app-color-picker header strong, .place-search-heading-title';
SELECTORS.selected += ', .workbench-sort-menu [role="radio"][aria-checked="true"]';

const MAX_RECTS = 30;
const OVERLAY_STYLE = `position:fixed;inset:0;z-index:2147483646;pointer-events:none;overflow:hidden;`;
const BOX_STYLE = `position:fixed;box-sizing:border-box;border:1px dashed rgba(37,132,255,.95);background:transparent;border-radius:2px;pointer-events:none;`;

function isVisible(el, win) {
  if (!el?.isConnected || el.closest('[data-material-target-overlay]')) return false;
  const style = win.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const vw = win.innerWidth, vh = win.innerHeight;
  // Ignore partially clipped targets. In particular, a fixed bottom bar outside
  // the visual viewport must not be represented by its clipped remnant.
  if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) return false;
  for (let p = el.parentElement; p && p !== el.ownerDocument.body; p = p.parentElement) {
    const ps = win.getComputedStyle(p);
    if (/(hidden|clip|scroll|auto)/.test(`${ps.overflow} ${ps.overflowX} ${ps.overflowY}`)) {
      const pr = p.getBoundingClientRect();
      if (r.left < pr.left || r.top < pr.top || r.right > pr.right || r.bottom > pr.bottom) return false;
    }
  }
  return true;
}

const PRIMARY='button.is-primary,button.route-primary,button.collection-primary,button.recording-start,button.pin-save,.home-recording-toggle:not([data-recording="true"])';
function isControl(el){
  if(el.closest('.workbench-tree-folder,.map-switch,.home-topbar,.home-map-actions,.map-toolbar'))return false;
  if(el.closest('.home-position-dock')&&!el.closest('.favorite-source-popup'))return false;
  if(el.matches('[type="color"],[type="range"],[type="checkbox"],[type="radio"],'+PRIMARY))return false;
  if(el.matches('button[aria-pressed="true"],button[aria-selected="true"],button[aria-current="true"],button.is-active'))return false;
  if(el.closest('.route-stop-block')&&!el.matches('.route-stop-block'))return false;
  return true;
}
function targetForElement(el){
  if(!el||el.closest('[data-material-target-overlay],.workbench-tree-folder'))return null;
  if(el.closest('.map-switch__track > span'))return 'knob';
  const toggle=el.closest('.map-switch');
  if(toggle)return toggle.dataset.checked==='true'?'accent':'switchOff';
  if(el.closest(SELECTORS.selected))return 'selected';
  if(el.closest(PRIMARY))return 'accent';
  if(el.closest(SELECTORS.text))return 'text';
  if(el.closest('.track-color-picker'))return 'controls';
  const control=el.closest(SELECTORS.controls);
  if(control&&isControl(control))return 'controls';
  if(el.closest('.favorite-source-popup'))return 'window';
  if(el.closest(SELECTORS.chrome))return 'chrome';
  if(el.closest(SELECTORS.window))return 'window';
  return null;
}

function isMapSurface(el) {
  return Boolean(el?.closest('canvas, .maplibregl-canvas, .mapboxgl-canvas, .map-canvas, .maplibregl-map, .mapboxgl-map, .map-surface'));
}

export function installMaterialTargets({ frame, onPick = () => {} } = {}) {
  let targetId = 'window';
  let visible = true;
  let picking = false;
  let dead = false;
  let scheduled = false;
  let doc = null, win = null, overlay = null, mutation = null, resizeObserver = null;
  let pendingPick = null;

  const cleanupDocument = () => {
    mutation?.disconnect();
    resizeObserver?.disconnect();
    if (doc) {
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('pointerup', onPointerUp, true);
      doc.removeEventListener('pointercancel', onPointerCancel, true);
      doc.removeEventListener('click', onClick, true);
      doc.removeEventListener('keydown', onKey, true);
      doc.removeEventListener('animationend',refresh,true);doc.removeEventListener('transitionend',refresh,true);
    }
    if (win) {
      win.removeEventListener('resize', refresh);
      win.removeEventListener('scroll', refresh, true);
    }
    overlay?.remove();
    mutation = resizeObserver = overlay = null;
    doc = win = null;
    pendingPick = null;
    scheduled = false;
  };

  const bindDocument = () => {
    if (dead) return;
    cleanupDocument();
    try { doc = frame?.contentDocument; win = frame?.contentWindow; } catch { doc = win = null; }
    if (!doc || !win || !doc.documentElement) return;
    overlay = doc.createElement('div');
    overlay.dataset.materialTargetOverlay = 'true';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = OVERLAY_STYLE;
    (doc.body || doc.documentElement).append(overlay);
    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('pointerup', onPointerUp, true);
    doc.addEventListener('pointercancel', onPointerCancel, true);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('keydown', onKey, true);
    doc.addEventListener('animationend',refresh,true);doc.addEventListener('transitionend',refresh,true);
    win.addEventListener('resize', refresh, { passive: true });
    win.addEventListener('scroll', refresh, { passive: true, capture: true });
    mutation = new win.MutationObserver(records => {
      const external = records.some(record => {
        if (overlay.contains(record.target)) return false;
        const changed = [...record.addedNodes, ...record.removedNodes];
        return !changed.length || changed.some(node => node !== overlay && !overlay.contains(node));
      });
      if (external) refresh();
    });
      mutation.observe(doc.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-expanded', 'aria-pressed', 'aria-selected', 'aria-current', 'aria-checked', 'checked', 'data-checked'] });
    resizeObserver = new win.ResizeObserver(refresh);
    resizeObserver.observe(doc.documentElement);
    if (doc.body) resizeObserver.observe(doc.body);
    refresh();
  };

  const render = () => {
    scheduled = false;
    if (dead || !doc || !overlay || !win) return;
    overlay.replaceChildren();
    overlay.style.display = visible ? 'block' : 'none';
    if (!visible || !TARGETS.has(targetId)) return;
    const selector = SELECTORS[targetId]+(targetId==='controls'?', .track-color-picker':targetId==='accent'||targetId==='accentText'?', .home-recording-toggle:not([data-recording="true"])':'');
    if (!selector) return;
    const candidates = [...doc.querySelectorAll(selector)].filter(el => isVisible(el, win) && (targetId !== 'controls' || isControl(el)) && (targetId !== 'selected' || !el.closest('.workbench-tree-folder')));
    // Keep the most useful, compact set instead of painting every nested item.
    const unique = [];
    for (const el of candidates) {
      if (unique.some(other => other === el || other.contains(el) && targetId === 'text')) continue;
      unique.push(el);
      if (unique.length >= MAX_RECTS) break;
    }
    for (const el of unique) {
      const rect = el.getBoundingClientRect();
      let { left, top, width, height } = rect;
      if(targetId==='selected'&&el.matches('.home-bottom-nav button[data-home-selected="true"]')){left+=4;width-=8;}
      if (targetId === 'chrome' && el.matches('.home-topbar')) {const host=el.closest('.observatory').getBoundingClientRect();left=host.left;width=host.width;top=host.top;height=48;}

      const box = doc.createElement('div');
      box.style.cssText = `${BOX_STYLE}left:${left}px;top:${top}px;width:${width}px;height:${height}px;`;
      overlay.append(box);
    }
  };
  const refresh = () => {
    if (scheduled || dead || !win) return;
    scheduled = true;
    win.requestAnimationFrame(render);
  };
  const onPointerDown = event => {
    if(!picking||dead)return;
    event.preventDefault();event.stopImmediatePropagation();
    pendingPick=targetForElement(doc.elementFromPoint(event.clientX,event.clientY));
  };
  const onPointerUp = event => {
    if(!picking||dead)return;
    event.preventDefault();event.stopImmediatePropagation();
  };
  const onPointerCancel = ()=>{pendingPick=null;};
  const onClick = event => {
    if(!picking||dead)return;
    event.preventDefault();event.stopImmediatePropagation();
    const el=doc.elementFromPoint(event.clientX,event.clientY),picked=targetForElement(el);
    pendingPick=null;
    if(picked&&isVisible(el,win)){picking=false;onPick(picked);}
  };
  const onKey = event => {
    if (!picking || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    picking = false;
    pendingPick = null;
    onPick(null);
  };
  frame?.addEventListener('load', bindDocument);
  bindDocument();
  refresh();

  return {
    setTarget(id) { if (TARGETS.has(id)) { targetId = id; refresh(); } },
    setVisible(value) { visible = Boolean(value); refresh(); },
    setPicking(value) { picking = Boolean(value); pendingPick = null; },
    refresh,
    destroy() {
      if (dead) return;
      dead = true;
      frame?.removeEventListener('load', bindDocument);
      cleanupDocument();
    },
  };
}
