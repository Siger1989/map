import type { Map } from 'maplibre-gl';

type DesktopPanDetail = {
  phase?: 'move' | 'end';
  dx?: unknown;
  dy?: unknown;
  handled?: boolean;
};

type DesktopPanEvent = CustomEvent<DesktopPanDetail>;

const MAX_PAN_PIXELS_PER_FRAME = 32;
const DESKTOP_PAN_EASE_ID = 'shantu-desktop-pan';

function isVisibleMap(element: HTMLElement): boolean {
  if (element.getClientRects().length === 0) return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth || rect.top >= window.innerHeight) {
    return false;
  }

  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = window.getComputedStyle(current);
    if (
      current.hidden ||
      current.inert ||
      current.getAttribute('aria-hidden') === 'true' ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.visibility === 'collapse'
    ) return false;
  }
  return true;
}

function isEligibleFirstMap(element: HTMLElement): boolean {
  // The comparison host keeps the original map mounted as the first pane and
  // adds a second map. Only the primary pane is allowed to initiate a pan;
  // CameraSync then moves the other pane through its existing path.
  if (element.classList.contains('map-comparison-secondary')) return false;
  const home = element.closest('.home-map');
  if (home?.getAttribute('data-comparing') === 'true' &&
      !element.classList.contains('map-comparison-primary')) return false;

  // Focus lock is owned by the app shell and exposed on an ancestor.
  if (element.closest('[data-focus-locked="true"]')) return false;
  return isVisibleMap(element);
}

/** Receives desktop-shell pan frames for this visible map only. */
export function installDesktopPanReceiver(map: Map, element: HTMLElement): () => void {
  let activePan = false;
  const onMoveStart = (event: { shantuDesktopPan?: boolean }) => {
    if (!event.shantuDesktopPan) activePan = false;
  };
  const onMoveEnd = (event: { shantuDesktopPan?: boolean }) => {
    if (event.shantuDesktopPan) activePan = false;
  };
  map.on('movestart', onMoveStart);
  map.on('moveend', onMoveEnd);

  const onPan = (event: Event) => {
    const panEvent = event as DesktopPanEvent;
    const detail = panEvent.detail;
    if (!detail || detail.handled === true) return;

    // Finish this receiver's own camera lifecycle even if the map became hidden
    // or locked after the pointer began. Never stop a camera another action owns.
    if (detail.phase === 'end') {
      if (!activePan) return;
      detail.handled = true;
      activePan = false;
      map.stop();
      return;
    }
    if (
      document.documentElement.dataset.shantuDesktop !== 'true' ||
      detail.phase !== 'move' ||
      !isEligibleFirstMap(element)
    ) return;

    const dx = detail.dx;
    const dy = detail.dy;
    if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    const magnitude = Math.hypot(dx, dy);
    if (magnitude === 0) return;
    const scale = Math.min(1, MAX_PAN_PIXELS_PER_FRAME / magnitude);
    const boundedX = dx * scale;
    const boundedY = dy * scale;

    // Claim the event before panBy emits MapLibre movement events, so another
    // mounted map cannot process the same frame.
    detail.handled = true;
    activePan = true;
    map.panBy(
      [boundedX, boundedY],
      {
        duration: 250,
        easeId: DESKTOP_PAN_EASE_ID,
        essential: true,
        easing: () => 1,
      },
      { shantuDesktopPan: true },
    );
  };

  window.addEventListener('shantu-desktop-pan', onPan);
  return () => {
    window.removeEventListener('shantu-desktop-pan', onPan);
    map.off('movestart', onMoveStart);
    map.off('moveend', onMoveEnd);
    if (activePan) {
      activePan = false;
      map.stop();
    }
  };
}
