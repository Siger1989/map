import { floatingGeometry, searchViewport, observeSearchViewport } from './floatingGeometry';
import {
  useLayoutEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import './suggestions.css';

export function FloatingSearch({
  anchor,
  owner,
  scrollable = false,
  desktop = false,
  expandToViewport = false,
  maxHeight = 200,
  children,
}: {
  anchor: HTMLElement | null;
  owner: string;
  scrollable?: boolean;
  desktop?: boolean;
  expandToViewport?: boolean;
  maxHeight?: number;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const routePanelHost = owner === 'route'
      ? document.querySelector<HTMLElement>('.observatory.home-map #map-control-panel:has(.route-panel)')
      : null;
    const update = () => {
      const viewport = searchViewport();
      const headerSearch = document.querySelector<HTMLElement>('.place-search');
      if (headerSearch && headerSearch.getBoundingClientRect().height > 0) {
        const bottom = viewport.top + viewport.height;
        viewport.top = Math.max(viewport.top, headerSearch.getBoundingClientRect().bottom);
        viewport.height = Math.max(0, bottom - viewport.top);
      }
      const footer = document.querySelector<HTMLElement>('.home-bottom-nav');
      if (footer && footer.getBoundingClientRect().height > 0) {
        const bottom = Math.min(viewport.top + viewport.height, footer.getBoundingClientRect().top);
        viewport.height = Math.max(0, bottom - viewport.top);
      }
      let anchorBounds = anchor.getBoundingClientRect();
      let routeSegment: { top: number; height: number } | null = null;
      if (owner === 'route' && !desktop) {
        if (routePanelHost) {
          const panelRect = routePanelHost.getBoundingClientRect();
          const panelStyle = getComputedStyle(routePanelHost);
          const routePanel = routePanelHost.querySelector<HTMLElement>('.route-panel');
          const routeContent = routePanelHost.querySelector<HTMLElement>('.dock-content');
          const expandedView = routePanel?.dataset.searchExpanded === 'true';
          if (!expandedView && panelRect.width > 0 && panelRect.height > 0 && panelStyle.display !== 'none' && panelStyle.visibility !== 'hidden') {
            if (routePanel?.dataset.searchActive === 'true' && routeContent) {
              const contentRect = routeContent.getBoundingClientRect();
              if (contentRect.height > 0 && anchorBounds.height > 0) {
                const delta = anchorBounds.height > contentRect.height
                  ? anchorBounds.top - contentRect.top
                  : anchorBounds.top < contentRect.top
                    ? anchorBounds.top - contentRect.top
                    : anchorBounds.bottom > contentRect.bottom
                      ? anchorBounds.bottom - contentRect.bottom
                      : 0;
                if (Math.abs(delta) > 1) {
                  routeContent.scrollTop += delta;
                  anchorBounds = anchor.getBoundingClientRect();
                }
              }
            }
            const safeTop = viewport.top + 4;
            const safeBottom = viewport.top + viewport.height - 4;
            const aboveHeight = Math.max(0, Math.min(safeBottom, panelRect.top) - safeTop);
            const belowTop = Math.max(safeTop, panelRect.bottom);
            const belowHeight = Math.max(0, safeBottom - belowTop);
            const useAbove = aboveHeight >= Math.min(maxHeight, belowHeight) || aboveHeight >= belowHeight;
            routeSegment = useAbove
              ? { top: safeTop, height: aboveHeight }
              : { top: belowTop, height: belowHeight };
            viewport.top = routeSegment.top;
            viewport.height = routeSegment.height;
          }
        }
      }
      const popupMaxHeight = Math.min(maxHeight, Math.max(0, viewport.height - 8));
      const geometry = floatingGeometry(anchorBounds, viewport, popupMaxHeight);
      if ((owner === 'place' || owner === 'route') && !desktop) {
        const controlBounds = Array.from(document.querySelectorAll<HTMLElement>(
          '.observatory.home-map .home-map-actions, .observatory.home-map .home-position-dock',
        ))
          .filter(control => {
            const bounds = control.getBoundingClientRect();
            const style = getComputedStyle(control);
            return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
          })
          .map(control => control.getBoundingClientRect())
          .filter(bounds => owner !== 'route' || (bounds.top < geometry.top + geometry.maxHeight && bounds.bottom > geometry.top));
        const safeRight = controlBounds.length
          ? Math.min(...controlBounds.map(bounds => bounds.left)) - 8
          : viewport.left + viewport.width - 4;
        geometry.width = Math.max(0, Math.min(300, viewport.width - 8, safeRight - viewport.left - 8));
        geometry.left = Math.max(viewport.left + 4, Math.min(geometry.left, safeRight - geometry.width));
      }
      setStyle(expandToViewport
        ? { ...geometry, top: viewport.top + 4, maxHeight: popupMaxHeight }
        : geometry);
    };
    update();
    const stopObservingViewport = observeSearchViewport(update);
    const panelObserver = routePanelHost && typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(update)
      : null;
    if (panelObserver && routePanelHost) panelObserver.observe(routePanelHost);
    return () => {
      stopObservingViewport();
      panelObserver?.disconnect();
    };
  }, [anchor, desktop, expandToViewport, maxHeight, owner]);
  const popupStyle = style && scrollable
    ? { ...style, height: style.maxHeight, display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' }
    : style;
  return style
    ? createPortal(
        <div
          className="floating-search suggestion-surface"
          style={popupStyle ?? undefined}
          data-search-owner={owner}
          data-search-scroll={scrollable ? 'true' : undefined}
          data-search-desktop={desktop && owner === 'place' ? 'true' : undefined}
          data-search-expanded-viewport={expandToViewport ? 'true' : undefined}
        >
          {children}
        </div>,
        document.body,
      )
    : null;
}
