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
      const popupMaxHeight = expandToViewport
        ? Math.min(maxHeight, Math.max(0, viewport.height - 8))
        : maxHeight;
      const geometry = floatingGeometry(anchor.getBoundingClientRect(), viewport, popupMaxHeight);
      if (owner === 'place' && !desktop) {
        const controlBounds = Array.from(document.querySelectorAll<HTMLElement>(
          '.observatory.home-map .home-map-actions, .observatory.home-map .home-position-dock',
        ))
          .map(control => control.getBoundingClientRect())
          .filter(bounds => bounds.width > 0 && bounds.height > 0);
        if (controlBounds.length) {
          const safeRight = Math.min(...controlBounds.map(bounds => bounds.left)) - 8;
          geometry.left = Math.max(viewport.left + 4, Math.min(geometry.left, safeRight - geometry.width));
        }
      }
      setStyle(expandToViewport
        ? { ...geometry, top: viewport.top + 4, maxHeight: popupMaxHeight }
        : geometry);
    };
    update();
    return observeSearchViewport(update);
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
