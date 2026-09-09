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
  children,
}: {
  anchor: HTMLElement | null;
  owner: string;
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
  return style
    ? createPortal(
        <div
          className="floating-search suggestion-surface"
          style={style}
          data-search-owner={owner}
        >
          {children}
        </div>,
        document.body,
      )
    : null;
}
