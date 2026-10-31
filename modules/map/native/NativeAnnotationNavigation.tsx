'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { Annotation } from '../../annotations/data.ts';
import { projectNativeLocal, unprojectNativeLocal } from './localGeometry.ts';
import type { NativeMapBridgeClient } from './client.ts';
import { nativeAnnotationNavigationPins } from './annotationNavigation.ts';

export type NativeAnnotationNavigationProps = {
  client: NativeMapBridgeClient;
  mapId: string;
  annotations: Annotation[];
  selectedId: string | null;
  onNavigate: (id: string, slot: 'start' | 'end') => void;
};

export function NativeAnnotationNavigation({ client, mapId, annotations, selectedId, onNavigate }: NativeAnnotationNavigationProps) {
  const [frame, setFrame] = useState(() => client.cameraFrame(mapId));
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const update = () => setFrame(client.cameraFrame(mapId));
    const unsubscribe = client.subscribe(mapId, 'renderFrame', update);
    update();
    return unsubscribe;
  }, [client, mapId]);
  useEffect(() => {
    if (openId && !annotations.some((item) => item.id === openId && item.visible && item.kind === 'pin')) setOpenId(null);
  }, [annotations, openId]);
  useEffect(() => { setOpenId(null); }, [selectedId, mapId]);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest('.native-annotation-navigation-control')) setOpenId(null);
    };
    const close = () => setOpenId(null);
    const unsubscribe = client.subscribe(mapId, 'touch', close);
    window.addEventListener('pointerdown', closeOutside, true);
    window.addEventListener('blur', close);
    return () => {
      unsubscribe();
      window.removeEventListener('pointerdown', closeOutside, true);
      window.removeEventListener('blur', close);
    };
  }, [client, mapId]);

  const pins = useMemo(() => nativeAnnotationNavigationPins(annotations, selectedId, frame, {
    elevation: (coordinate) => client.geometry(mapId).elevation(coordinate),
    project: (coordinate) => {
      const point = projectNativeLocal(client, mapId, coordinate);
      return point ? { status: 'ready' as const, value: point } : { status: 'blocked' as const };
    },
    unproject: (point) => {
      const coordinate = unprojectNativeLocal(client, mapId, point);
      return coordinate ? { status: 'ready' as const, value: { coordinate } } : { status: 'blocked' as const };
    },
  }), [annotations, client, frame, mapId, selectedId]);
  const overlayStyle: CSSProperties = { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 4 };

  return <div className="native-annotation-navigation-overlay" style={overlayStyle} aria-label="标记快速导航">
    {pins.map(({ annotation, x, y }) => {
      const expanded = openId === annotation.id;
      // Native glyph/text own the area above the ground anchor. Do not size a
      // WebView hit region using an invisible duplicate of that label: its text
      // metrics differ from WorldWind and can put navigation over the glyph.
      const markerStyle: CSSProperties = {
        position: 'absolute', left: x, top: y + 12, transform: 'translateX(-50%)',
        pointerEvents: 'none', '--marker-color': annotation.color,
        '--marker-ink': isLight(annotation.color) ? '#17352b' : '#fff',
      } as CSSProperties;
      return <div key={annotation.id} className="native-annotation-navigation-control"
        data-annotation-id={annotation.id} style={markerStyle}>
          <button type="button" className="native-annotation-quick-nav" data-native-map-ui
            aria-label={`快速导航到${annotation.name || '标记'}`} aria-expanded={expanded}
            style={{ pointerEvents: 'auto' }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => { event.stopPropagation(); setOpenId(expanded ? null : annotation.id); }}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21 11 3l3 7 7 3-18 8Zm7-7 4-2-2-2-2 4Z" fillRule="evenodd"/></svg>
          </button>
          <span className="native-annotation-nav-menu" data-native-map-ui hidden={!expanded} style={{ pointerEvents: expanded ? 'auto' : 'none' }}
            onPointerDown={(event) => event.stopPropagation()}>
            {(['start', 'end'] as const).map((slot) => <button type="button" key={slot} data-native-map-ui
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => { event.stopPropagation(); setOpenId(null); onNavigate(annotation.id, slot); }}>
              {slot === 'start' ? '设为起点' : '设为终点'}
            </button>)}
          </span>
      </div>;
    })}
  </div>;
}

function isLight(color: string): boolean {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (!match) return false;
  const channels = [0, 2, 4].map((index) => parseInt(match[1]!.slice(index, index + 2), 16) / 255);
  const linear = channels.map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return linear[0]! * .2126 + linear[1]! * .7152 + linear[2]! * .0722 > .45;
}
