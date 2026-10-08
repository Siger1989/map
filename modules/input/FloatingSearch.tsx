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
  maxHeight = 200,
  children,
}: {
  anchor: HTMLElement | null;
  owner: string;
  scrollable?: boolean;
  desktop?: boolean;
  maxHeight?: number;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => {
      setStyle(floatingGeometry(anchor.getBoundingClientRect(), searchViewport(), maxHeight));
    };
    update();
    return observeSearchViewport(update);
  }, [anchor, maxHeight]);
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
        >
          {children}
        </div>,
        document.body,
      )
    : null;
}
