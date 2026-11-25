import { useEffect, useRef, useState, type RefObject } from 'react';
import type { MapHandle } from '../map/TerrainMap';
import type { DrawingInput } from '../tracks/DrawingGestureBridge';
import type { ScreenPoint } from '../tracks/drawing';
import type { Coordinate } from '../navigation/types';

type Shape = 'rectangle' | 'circle';
export type PrintSelection = {
  shape: Shape;
  bounds: { west: number; south: number; east: number; north: number };
};

function selectionBetween(shape: Shape, a: Coordinate, b: Coordinate): PrintSelection | null {
  if (Math.abs(a[0] - b[0]) >= 180) return null;
  let west = Math.min(a[0], b[0]), east = Math.max(a[0], b[0]);
  let south = Math.min(a[1], b[1]), north = Math.max(a[1], b[1]);
  if (shape === 'circle') {
    const longitudeScale = Math.cos(a[1] * Math.PI / 180);
    if (longitudeScale < 0.01) return null;
    const radius = Math.hypot((a[0] - b[0]) * longitudeScale, a[1] - b[1]);
    west = a[0] - radius / longitudeScale;
    east = a[0] + radius / longitudeScale;
    south = a[1] - radius;
    north = a[1] + radius;
  }
  if (east - west < 0.00001 || north - south < 0.00001 ||
      west < -180 || east > 180 || south < -85 || north > 85) return null;
  return { shape, bounds: { west, south, east, north } };
}

function outline({ shape, bounds: { west, east, south, north } }: PrintSelection): Coordinate[] {
  if (shape === 'rectangle') {
    return [[west, north], [east, north], [east, south], [west, south]];
  }
  return Array.from({ length: 72 }, (_, index) => {
    const angle = index * Math.PI / 36;
    return [(west + east) / 2 + (east - west) / 2 * Math.cos(angle),
      (south + north) / 2 + (north - south) / 2 * Math.sin(angle)];
  });
}

type Gesture = { origin: ScreenPoint; point: Coordinate; latest: Coordinate; moved: boolean };

export function useTerrainPrintSelection(map: RefObject<MapHandle | null>) {
  const [open, setOpen] = useState(false);
  const [shape, setShape] = useState<Shape | null>(null);
  const [selection, setSelection] = useState<PrintSelection | null>(null);
  const previewListener = useRef<((selection: PrintSelection | null) => void) | null>(null);
  const [anchor, setAnchor] = useState<Coordinate | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const anchorRef = useRef<Coordinate | null>(null);
  function setStart(point: Coordinate | null) {
    anchorRef.current = point;
    setAnchor(point);
  }
  function cancelPicking() {
    gesture.current = null;
    setStart(null);
    previewListener.current?.(null);
    setShape(null);
  }
  function close() {
    cancelPicking();
    setOpen(false);
    setSelection(null);
  }
  function pick(next: Shape) {
    cancelPicking();
    setShape(next);
  }
  function input(event: DrawingInput) {
    if (!shape) return;
    if (event.type === 'start' || event.type === 'move') {
      const coordinate = map.current?.toCoordinate(event.point);
      if (!coordinate) return;
      if (event.type === 'start') {
        gesture.current = { origin: event.point, point: coordinate, latest: coordinate, moved: false };
        return;
      }
      const current = gesture.current;
      if (!current) return;
      current.latest = coordinate;
      current.moved ||= Math.hypot(event.point.x - current.origin.x, event.point.y - current.origin.y) >= 5;
      const start = anchorRef.current ?? current.point;
      if (current.moved || anchorRef.current) previewListener.current?.(selectionBetween(shape, start, coordinate));
      return;
    }
    const current = gesture.current;
    gesture.current = null;
    previewListener.current?.(null);
    if (event.type !== 'end' || event.reason !== 'release' || !current) return;
    const start = anchorRef.current;
    if (!start && !current.moved) {
      setStart(current.point);
      return;
    }
    const result = selectionBetween(shape, start ?? current.point, current.latest);
    if (!result) return;
    setSelection(result);
    cancelPicking();
  }
  return { open, show: () => setOpen(true), close, shape, selection, previewListener, anchor, pick, cancelPicking, input };
}

export function TerrainPrintSelectionOverlay({ map, selection, anchor, previewListener }: {
  map: RefObject<MapHandle | null>;
  selection: PrintSelection | null;
  anchor: Coordinate | null;
  previewListener: RefObject<((selection: PrintSelection | null) => void) | null>;
}) {
  const [draft, setDraft] = useState<PrintSelection | null>(null);
  const visible = draft ?? selection;
  useEffect(() => {
    previewListener.current = setDraft;
    return () => { previewListener.current = null; };
  }, [previewListener]);
  const polygon = useRef<SVGPolygonElement>(null);
  const marker = useRef<SVGCircleElement>(null);
  useEffect(() => {
    const renderer = map.current;
    if (!renderer) return;
    const ring = visible ? outline(visible) : null;
    const render = () => {
      const points = ring?.map(point => renderer.toScreen(point));
      polygon.current?.setAttribute('points', points?.every(point => point !== null)
        ? points.map(point => point!.x + ',' + point!.y).join(' ') : '');
      const screen = anchor ? renderer.toScreen(anchor) : null;
      marker.current?.setAttribute('visibility', screen ? 'visible' : 'hidden');
      if (screen) {
        marker.current?.setAttribute('cx', String(screen.x));
        marker.current?.setAttribute('cy', String(screen.y));
      }
    };
    render();
    return renderer.watchObjectProjection(render);
  }, [map, visible, anchor]);
  return (
    <svg aria-hidden="true" className="terrain-print-selection" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 4, pointerEvents: 'none' }}>
      <polygon ref={polygon} fill="var(--ui-accent, #ebad39)" fillOpacity={0.18} stroke="var(--ui-accent, #ebad39)" strokeWidth={2} />
      <circle ref={marker} r={4} visibility="hidden" fill="var(--ui-accent, #ebad39)" />
    </svg>
  );
}
