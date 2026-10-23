'use client';

import { memo, useLayoutEffect, useRef, useState } from 'react';
import type { GeologyState } from './data';

type Bounds = { top: number; right: number; height: number; visible: boolean };
const initialBounds: Bounds = { top: 0, right: 8, height: 0, visible: false };

export const GeologyMapLegend = memo(function GeologyMapLegend({ state, source }: {
  state: GeologyState;
  source: GeologyState['source'];
}) {
  const root = useRef<HTMLElement>(null);
  const eligible = source === 'world' && state.source === source && state.legend.length > 0;
  const [bounds, setBounds] = useState(initialBounds);

  useLayoutEffect(() => {
    if (!eligible) {
      setBounds(initialBounds);
      return;
    }
    const element = root.current;
    const main = element?.closest<HTMLElement>('main');
    const host = element?.closest<HTMLElement>('.observatory');
    if (!element || !main || !host) return;

    const actions = host.querySelector<HTMLElement>('.home-map-actions');
    const dock = host.querySelector<HTMLElement>('.home-position-dock');
    const scale = host.querySelector<HTMLElement>('.maplibregl-ctrl-scale');
    const measure = () => {
      const mainRect = main.getBoundingClientRect();
      const actionsRect = actions?.getBoundingClientRect();
      const scaleRect = scale?.getBoundingClientRect();
      const dockRect = dock?.getBoundingClientRect();
      const top = Math.max(
        actionsRect?.bottom ?? 0,
        scaleRect?.bottom ?? 0,
      ) - mainRect.top + 8;
      const bottom = (dockRect?.top ?? mainRect.bottom) - mainRect.top - 8;
      const height = Math.max(0, Math.min(196, bottom - top));
      const right = actionsRect
        ? Math.max(8, mainRect.right - actionsRect.right)
        : 8;
      const next = { top, right, height, visible: height >= 68 };
      setBounds(current => current.top === next.top && current.right === next.right &&
        current.height === next.height && current.visible === next.visible ? current : next);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(main);
    if (actions) observer.observe(actions);
    if (dock) observer.observe(dock);
    if (scale) observer.observe(scale);
    window.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('resize', measure);
    };
  }, [eligible, state.legend.length]);

  return (
    <aside
      ref={root}
      className="geology-map-legend"
      aria-label="地质颜色对照"
      hidden={!eligible || !bounds.visible}
      style={{ top: bounds.top, right: bounds.right, height: bounds.height, maxHeight: bounds.height }}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onWheel={event => event.stopPropagation()}
    >
      <section className="geology-map-legend-cursor" aria-label="当前光标地质">
        {state.cursorSelection ? <>
          <i style={{ backgroundColor: state.cursorSelection.color }} aria-hidden="true" />
          <span>{state.cursorSelection.name}</span>
        </> : <span>暂无地质</span>}
      </section>
      <section className="geology-map-legend-list" aria-label="全部地质类型" tabIndex={0}>
        <ul>
          {state.legend.map(unit => (
            <li key={unit.key}>
              <i style={{ backgroundColor: unit.color }} aria-hidden="true" />
              <span>{unit.name}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
});
