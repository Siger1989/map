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
  children,
}: {
  anchor: HTMLElement | null;
  owner: string;
  scrollable?: boolean;
  children: ReactNode;
}) {
  const [style, setStyle] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const update = () => {
      setStyle(floatingGeometry(anchor.getBoundingClientRect(), searchViewport()));
    };
    update();
    return observeSearchViewport(update);
  }, [anchor]);
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
        >
          {children}
        </div>,
        document.body,
      )
    : null;
}
