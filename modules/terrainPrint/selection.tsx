import { useEffect, useRef, useState, type PointerEvent, type RefObject } from 'react';
import { Move } from 'lucide-react';
import type { MapHandle } from '../map/TerrainMap';
import type { DrawingInput } from '../tracks/DrawingGestureBridge';
import type { ScreenPoint } from '../tracks/drawing';
import type { Coordinate } from '../navigation/types';

type Shape = 'rectangle' | 'circle';
type Handle = 'move' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type PrintSelection = {
  shape: Shape;
  bounds: { west: number; south: number; east: number; north: number };
};
const MIN_SPAN = 0.00001;
const SCALE = Math.PI / 180;

export function selectionGroundSize({ bounds: { west, east, south, north } }: PrintSelection) {
  const latitude = (south + north) * SCALE / 2;
  const eccentricitySquared = 0.00669437999014;
  const axis = Math.sqrt(1 - eccentricitySquared * Math.sin(latitude) ** 2);
  return {
    width: (east - west) * SCALE * 6_378_137 * Math.cos(latitude) / axis,
    height: (north - south) * SCALE * 6_378_137 * (1 - eccentricitySquared) / axis ** 3,
  };
}

function circleLongitudeScale(latitude: number) {
  return Math.cos(latitude * SCALE) * (1 - 0.00669437999014 * Math.sin(latitude * SCALE) ** 2) / (1 - 0.00669437999014);
}

function validSelection({ west, east, south, north }: PrintSelection['bounds']) {
  return east - west >= MIN_SPAN && east - west < 180 && north - south >= MIN_SPAN &&
    west >= -180 && east <= 180 && south >= -85 && north <= 85;
}

function selectionBetween(shape: Shape, a: Coordinate, b: Coordinate): PrintSelection | null {
  if (Math.abs(a[0] - b[0]) >= 180) return null;
  let west = Math.min(a[0], b[0]), east = Math.max(a[0], b[0]);
  let south = Math.min(a[1], b[1]), north = Math.max(a[1], b[1]);
  if (shape === 'circle') {
    const longitudeScale = circleLongitudeScale(a[1]);
    if (longitudeScale < 0.01) return null;
    const radius = Math.hypot((a[0] - b[0]) * longitudeScale, a[1] - b[1]);
    west = a[0] - radius / longitudeScale;
    east = a[0] + radius / longitudeScale;
    south = a[1] - radius;
    north = a[1] + radius;
  }
  const bounds = { west, south, east, north };
  return validSelection(bounds) ? { shape, bounds } : null;
}

const handleLabels: Record<Handle, string> = {
  move: '移动选区', nw: '左上角', n: '上边', ne: '右上角', e: '右边',
  se: '右下角', s: '下边', sw: '左下角', w: '左边',
};
const rectangleHandles: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const circleHandles: Handle[] = ['n', 'e', 's', 'w'];

function handleCoordinate({ bounds: { west, east, south, north } }: PrintSelection, handle: Handle): Coordinate {
  const midLongitude = (west + east) / 2;
  const longitude = handle === 'move' ? midLongitude : handle.includes('w') ? west : handle.includes('e') ? east : midLongitude;
  const latitude = handle.includes('n') ? north : handle.includes('s') ? south : (south + north) / 2;
  return [longitude, latitude];
}

function editSelection(selection: PrintSelection, handle: Handle, start: Coordinate, next: Coordinate): PrintSelection | null {
  const [dx, dy] = [next[0] - start[0], next[1] - start[1]];
  if (Math.abs(dx) >= 180) return null;
  const [longitude, latitude] = handleCoordinate(selection, handle);
  if (handle === 'move') {
    const { west, east, south, north } = selection.bounds;
    const newLatitude = latitude + dy;
    if (newLatitude < -85 || newLatitude > 85) return null;
    const halfWidth = (east - west) / 2 * circleLongitudeScale(latitude) / circleLongitudeScale(newLatitude);
    const bounds = { west: longitude + dx - halfWidth, east: longitude + dx + halfWidth, south: south + dy, north: north + dy };
    return validSelection(bounds) ? { ...selection, bounds } : null;
  }
  if (selection.shape === 'circle') {
    const center = handleCoordinate(selection, 'move');
    const minimumRadius = MIN_SPAN;
    const boundary: Coordinate = handle === 'e' || handle === 'w'
      ? [handle === 'e' ? Math.max(center[0] + minimumRadius, longitude + dx) : Math.min(center[0] - minimumRadius, longitude + dx), center[1]]
      : [center[0], handle === 'n' ? Math.max(center[1] + minimumRadius, latitude + dy) : Math.min(center[1] - minimumRadius, latitude + dy)];
    return selectionBetween('circle', center, boundary);
  }
  const bounds = { ...selection.bounds };
  if (handle.includes('w')) bounds.west = Math.min(bounds.east - MIN_SPAN, bounds.west + dx);
  if (handle.includes('e')) bounds.east = Math.max(bounds.west + MIN_SPAN, bounds.east + dx);
  if (handle.includes('s')) bounds.south = Math.min(bounds.north - MIN_SPAN, bounds.south + dy);
  if (handle.includes('n')) bounds.north = Math.max(bounds.south + MIN_SPAN, bounds.north + dy);
  return validSelection(bounds) ? { ...selection, bounds } : null;
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
  return { open, show: () => setOpen(true), close, shape, selection, previewListener, anchor, pick, cancelPicking, input, setSelection };
}

export function TerrainPrintSelectionOverlay({ map, selection, anchor, previewListener, editable, onAdjust }: {
  map: RefObject<MapHandle | null>;
  selection: PrintSelection | null;
  anchor: Coordinate | null;
  previewListener: RefObject<((selection: PrintSelection | null) => void) | null>;
  editable: boolean;
  onAdjust: (selection: PrintSelection) => void;
}) {
  const [draft, setDraft] = useState<PrintSelection | null>(null);
  const [dragging, setDragging] = useState(false);
  const visible = draft ?? selection;
  const overlay = useRef<HTMLDivElement>(null);
  const handles = useRef<Partial<Record<Handle, HTMLButtonElement | null>>>({});
  const edit = useRef<{
    handle: Handle; id: number; original: PrintSelection; start: Coordinate;
    bounds: DOMRect; scaleX: number; scaleY: number; next: PrintSelection | null;
    frame: number; point: ScreenPoint | null;
  } | null>(null);
  const availableHandles = selection?.shape === 'circle' ? circleHandles : rectangleHandles;
  useEffect(() => () => { if (edit.current?.frame) cancelAnimationFrame(edit.current.frame); }, []);
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
      const pointData = points?.every(point => point !== null) ? points.map(point => point!.x + ',' + point!.y).join(' ') : '';
      if (polygon.current?.getAttribute('points') !== pointData) polygon.current?.setAttribute('points', pointData);
      const screen = anchor ? renderer.toScreen(anchor) : null;
      marker.current?.setAttribute('visibility', screen ? 'visible' : 'hidden');
      if (screen) {
        marker.current?.setAttribute('cx', String(screen.x));
        marker.current?.setAttribute('cy', String(screen.y));
      }
      const center = visible ? renderer.toScreen(handleCoordinate(visible, 'move')) : null;
      for (const [name, button] of Object.entries(handles.current)) {
        if (!button) continue;
        const edge = visible && name.length === 1 && visible.shape === 'rectangle';
        const adjacent = edge && edit.current?.handle !== name ? rectangleHandles.filter(handle => handle.length === 2 && handle.includes(name))
          .map(handle => renderer.toScreen(handleCoordinate(visible, handle))) : [];
        const position = visible && (name === 'move' ? center : renderer.toScreen(handleCoordinate(visible, name as Handle)));
        if (!position || !center || adjacent.some(point => !point || Math.hypot(point.x - position.x, point.y - position.y) < 34)) {
          button.hidden = true;
          continue;
        }
        const dx = position.x - center.x, dy = position.y - center.y;
        const separation = name === 'move' ? 0 : Math.max(1, Math.hypot(dx, dy));
        const factor = separation ? Math.max(1, 31 / separation) : 1;
        const transform = `translate(${Math.round(center.x + dx * factor)}px, ${Math.round(center.y + dy * factor)}px) translate(-50%, -50%)`;
        if (button.style.transform !== transform) button.style.transform = transform;
        button.hidden = false;
      }
    };
    render();
    return renderer.watchObjectProjection(render);
  }, [map, visible, anchor, editable]);

  function pointFor(event: PointerEvent, rect: DOMRect, scaleX: number, scaleY: number) {
    return { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
  }
  function begin(event: PointerEvent<HTMLButtonElement>, handle: Handle) {
    const host = overlay.current;
    if (!host || !selection || !event.isPrimary || event.button !== 0 || edit.current) return;
    const bounds = host.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const scaleX = host.clientWidth / bounds.width, scaleY = host.clientHeight / bounds.height;
    const start = map.current?.toCoordinate(pointFor(event, bounds, scaleX, scaleY));
    if (!start) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    edit.current = { handle, id: event.pointerId, original: selection, start, bounds, scaleX, scaleY, next: null, frame: 0, point: null };
    setDragging(true);
  }
  function update(current: NonNullable<typeof edit.current>, point: ScreenPoint) {
    const coordinate = map.current?.toCoordinate(point);
    if (!coordinate) return;
    const next = editSelection(current.original, current.handle, current.start, coordinate);
    if (!next) return;
    current.next = next;
    setDraft(next);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const current = edit.current;
    if (!current || current.id !== event.pointerId) return;
    current.point = pointFor(event, current.bounds, current.scaleX, current.scaleY);
    if (!current.frame) current.frame = requestAnimationFrame(() => {
      current.frame = 0;
      if (current.point) update(current, current.point);
    });
  }
  function finish(event: PointerEvent<HTMLButtonElement>, commit: boolean) {
    const current = edit.current;
    if (!current || current.id !== event.pointerId) return;
    if (current.frame) cancelAnimationFrame(current.frame);
    edit.current = null;
    if (commit && current.point) {
      update(current, pointFor(event, current.bounds, current.scaleX, current.scaleY));
      if (current.next) onAdjust(current.next);
    }
    setDraft(null);
    setDragging(false);
  }
  return (
    <div ref={overlay} className="terrain-print-selection" data-dragging={dragging}>
    <svg aria-hidden="true" width="100%" height="100%">
      <polygon ref={polygon} fill="var(--ui-accent, #ebad39)" fillOpacity={0.18} stroke="var(--ui-accent, #ebad39)" strokeWidth={2} />
      <circle ref={marker} r={4} visibility="hidden" fill="var(--ui-accent, #ebad39)" />
    </svg>
    {selection && editable && [...availableHandles, 'move' as const].map(handle =>
      <button key={handle} ref={button => { handles.current[handle] = button; }} type="button" hidden
        className="terrain-print-handle" data-terrain-handle={handle} data-native-map-ui
        aria-label={handle === 'move' ? handleLabels.move : `调整选区${handleLabels[handle]}`}
        onPointerDown={event => begin(event, handle)} onPointerMove={move}
        onPointerUp={event => finish(event, true)} onPointerCancel={event => finish(event, false)}
        onLostPointerCapture={event => finish(event, false)}>
        {handle === 'move' ? <Move size={15} aria-hidden="true" /> : <span aria-hidden="true" />}
      </button>)}
    </div>
  );
}
