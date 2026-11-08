import { useEffect, useRef, useState } from 'react';
import type { NativeMapBridgeClient } from './native/client.ts';
import { unprojectNativeLocal } from './native/localGeometry.ts';
import { groundDistanceMeters, makeMapScaleMark, type MapScaleMark } from './native/scale.ts';
import { subscribeNativeProjectionEvents } from './native/projectionSyncScheduler.ts';
import './nativeScale.css';

const SCALE_WIDTH = 72;
const SAMPLE_OFFSET_X = 0;
const SAMPLE_LINE_Y = 5;

/** Renders a ground scale from the latest native projection and terrain frame. */
export function NativeScaleOverlay({ client, mapId }: { client: NativeMapBridgeClient; mapId: string }) {
  const root = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState<MapScaleMark | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      timer = null;
      const element = root.current, map = element?.parentElement;
      if (!element || !map || !client.cameraFrame(mapId)) { setMark(null); return; }
      const elementRect = element.getBoundingClientRect(), mapRect = map.getBoundingClientRect();
      const y = elementRect.top - mapRect.top + SAMPLE_LINE_Y;
      const a = unprojectNativeLocal(client, mapId, { x: elementRect.left - mapRect.left + SAMPLE_OFFSET_X, y });
      const b = unprojectNativeLocal(client, mapId, { x: elementRect.left - mapRect.left + SAMPLE_OFFSET_X + SCALE_WIDTH, y });
      const distance = a && b ? groundDistanceMeters(a, b) : null;
      const next = makeMapScaleMark(distance, SCALE_WIDTH);
      setMark(previous => previous?.label === next?.label && Math.abs((previous?.width ?? 0) - (next?.width ?? 0)) < 0.5 ? previous : next);
    };
    const schedule = () => {
      if (timer !== null) return;
      timer = setTimeout(refresh, 80);
    };
    const unsubscribe = subscribeNativeProjectionEvents(client, mapId, schedule);
    const map = root.current?.parentElement;
    const resize = typeof ResizeObserver === 'undefined' || !map ? null : new ResizeObserver(schedule);
    if (map) resize?.observe(map);
    const home = map?.closest('.observatory.home-map');
    const mutations = typeof MutationObserver === 'undefined' || !home ? null : new MutationObserver(schedule);
    if (home) mutations?.observe(home, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'style', 'data-panel', 'data-comparing'] });
    window.addEventListener('resize', schedule);
    refresh();
    return () => {
      unsubscribe.forEach(stop => stop());
      if (timer !== null) clearTimeout(timer);
      resize?.disconnect();
      mutations?.disconnect();
      window.removeEventListener('resize', schedule);
    };
  }, [client, mapId]);

  return (
    <div ref={root} className="native-map-scale" role="img" data-scale-state={mark ? 'ready' : 'unavailable'}
      aria-label={mark ? `比例尺 ${mark.label}` : '比例尺暂不可用'}>
      {mark && <>
        <span className="native-map-scale-line" style={{ width: `${mark.width}px` }} />
        <span className="native-map-scale-label">{mark.label}</span>
      </>}
    </div>
  );
}
