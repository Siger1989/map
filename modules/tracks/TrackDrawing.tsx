import {
  forwardRef,
  useEffect,
  useLayoutEffect,
  useImperativeHandle,
  useRef,
  useMemo,
  useState,
} from 'react';
import { formatDistance, type Coordinate } from '../navigation/types';
import { trackDistance, type ScreenPoint } from './drawing';
import type { DrawingInput } from './DrawingGestureBridge';
import type { TrackStyle } from './style';
import type { DrawingMode } from './draft';
import { DrawingSession, type DrawingPreview } from './DrawingSession';
import { handlePoint } from './precision';
import { PointMagnifier, type MagnifierObserver } from './PointMagnifier';
import type { RoadSnapper } from './roadSnapping';
import { riverHint } from './riverSnapping';
import type { SnapViewport } from './snapping';
import type { TrackRenderReceipt } from './trackRenderHandoff';
import { isDesktopShell } from '../platform/desktop';
export type TrackDrawingHandle = {
  input: (event: DrawingInput) => void;
  retainCommit: (receipt: TrackRenderReceipt, line: Coordinate[]) => void;
};
type CommitInk = { receipt: TrackRenderReceipt; paths: string[]; style: TrackStyle };

/** Visual-only overlay: touches continue to the map's native two-finger handlers. */
export const TrackDrawing = forwardRef<
  TrackDrawingHandle,
  {
    enabled: boolean;
    committedSegments?: Coordinate[][];
    waitForCommit?: (receipt: TrackRenderReceipt, done: () => void) => () => void;
    distanceSegments?: Coordinate[][];
    length: number;
    style: TrackStyle;
    mode: DrawingMode;
    anchor: Coordinate | null;
    candidates: Coordinate[];
    snapping: boolean;
    roadSnapping: boolean;
    riverSnapping?: boolean;
    snapRoad: RoadSnapper;
    lastVertex: Coordinate | null;
    toCoordinate: (point: ScreenPoint) => Coordinate | null;
    toScreen: (point: Coordinate) => ScreenPoint | null;
    getSnapViewport?: () => SnapViewport | null;
    magnify: MagnifierObserver;
    onAnchor: (point: Coordinate) => void;
    onVertex: (point: Coordinate, section?: Coordinate[]) => void;
    onStroke: (points: Coordinate[]) => void;
  }
>(function TrackDrawing(p, ref) {
  const svg = useRef<SVGSVGElement>(null),
    session = useRef(new DrawingSession());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [preview, setPreview] = useState<DrawingPreview | null>(null),
    [hint, setHint] = useState('');
  const [commitInk, setCommitInk] = useState<CommitInk | null>(null);
  const pendingInk = useRef<CommitInk | null>(null);
  const stopWaiting = useRef<(() => void) | null>(null);
  const clearCommit = () => {
    stopWaiting.current?.();
    stopWaiting.current = null;
    pendingInk.current = null;
    setCommitInk(null);
  };
  useEffect(() => () => stopWaiting.current?.(), []);
  useLayoutEffect(() => {
    // Undo, exit, or a different edit invalidates this accepted geometry.
    if (pendingInk.current && p.committedSegments !== pendingInk.current.receipt.segments) clearCommit();
  }, [p.committedSegments]);
  const committedDistance = useMemo(() => trackDistance(p.distanceSegments ?? []), [p.distanceSegments]);
  useEffect(() => {
    if (!p.enabled || !svg.current) {
      session.current.clear();
      setPreview(null);
      setHint('');
      return;
    }
    const element = svg.current;
    const update = () =>
      setSize({ width: element.clientWidth, height: element.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [p.enabled]);
  useEffect(() => {
    session.current.clear();
    setPreview(null);
  }, [p.mode, p.anchor, p.roadSnapping, p.riverSnapping]);
  useImperativeHandle(ref, () => ({
    retainCommit: (receipt, line) => {
      if (!p.waitForCommit || line.length < 2) return;
      const screen = line.map(p.toScreen);
      if (screen.some(point => !point)) return;
      const path = screen.map((point, index) => `${index ? 'L' : 'M'} ${point!.x} ${point!.y}`).join(' ');
      stopWaiting.current?.();
      const previous = pendingInk.current;
      const ink = { receipt, paths: [...(previous?.receipt.trackId === receipt.trackId ? previous.paths : []), path], style: p.style };
      pendingInk.current = ink;
      setCommitInk(ink);
      stopWaiting.current = p.waitForCommit(receipt, () => {
        if (pendingInk.current === ink) clearCommit();
      });
    },
    input: (event) => {
      if (!p.enabled) {
        session.current.clear();
        return;
      }
      const result = session.current.input(event, {
        ...size,
        mode: p.mode,
        anchor: p.anchor,
        length: p.length,
        candidates: p.candidates,
        snapping: p.snapping,
        roadSnapping: p.roadSnapping,
        strictNetwork: p.riverSnapping,
        snapRoad: p.snapRoad,
        lastVertex: p.lastVertex,
        project: p.toScreen,
        unproject: p.toCoordinate,
        getSnapViewport: p.getSnapViewport,
      });
      setPreview(result.preview);
      setHint(p.riverSnapping ? riverHint(result.hint) : result.hint);
      if (result.anchor) p.onAnchor(result.anchor);
      if (result.vertex) p.onVertex(result.vertex, result.section);
      if (result.stroke) p.onStroke(result.stroke);
    },
  }));
  if (!p.enabled && !commitInk) return null;
  const anchor = p.anchor && p.toScreen(p.anchor),
    handle = anchor && handlePoint(anchor, p.length, size.height);
  const last = p.lastVertex && p.toScreen(p.lastVertex);
  const distanceTip = preview?.blocked && preview.kind === 'aim'
    ? (last ?? anchor) : (preview?.tip ?? (p.mode === 'freehand' ? anchor : last));
  const distanceText = `累计 ${formatDistance(committedDistance + (preview?.distanceMetres ?? 0))}`;
  const labelWidth = Math.max(88, distanceText.length * 8 + 16);
  const labelBelow = preview?.kind === 'aim' && distanceTip && distanceTip.y > 125;
  const desktopShell = isDesktopShell();
  const instruction =
    hint ||
    (p.mode === 'points'
      ? p.riverSnapping
        ? `河流吸附 · 准星沿河定点 · ${desktopShell ? '顶部控制器平移' : '双指控图'}`
        : desktopShell
          ? '准星定点 · 松开鼠标连接 · 顶部控制器平移'
          : '准星定点 · 松手连接 · 双指控图'
      : p.anchor
        ? '② 起点已定：按住绿色环拖动即可画线'
        : '① 按住地图移动准星，松手只确认起点');
  return (
    <>
      <svg ref={svg} className="track-drawing" aria-hidden="true">
        {commitInk && <g data-drawing-commit="pending">
          {commitInk.paths.map((path, index) => <g key={index}>
            <path d={path} fill="none" stroke="white" strokeOpacity={.65 * (commitInk.style.opacity ?? 1)} strokeWidth={commitInk.style.width + 2} strokeLinecap="round" strokeLinejoin="round" />
            <path d={path} fill="none" stroke={commitInk.style.color} strokeOpacity={commitInk.style.opacity ?? 1} strokeWidth={commitInk.style.width} strokeLinecap="round" strokeLinejoin="round" />
          </g>)}
        </g>}
        {!preview && p.mode === 'freehand' && anchor && handle && (
          <g>
            <line
              x1={anchor.x}
              y1={anchor.y}
              x2={handle.x}
              y2={handle.y}
              stroke="#a7efd0"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={anchor.x}
              cy={anchor.y}
              r="4"
              fill={p.style.color}
              stroke="white"
            />
            <circle
              cx={handle.x}
              cy={handle.y}
              r="14"
              fill="#10212bcc"
              stroke="#a7efd0"
              strokeWidth="2"
            />
            <path
              d={`M ${handle.x - 4} ${handle.y} h 8 M ${handle.x} ${handle.y - 4} v 8`}
              stroke="#a7efd0"
            />
          </g>
        )}
        {preview && (
          <g>
            {preview.kind === 'aim' &&
              p.mode === 'points' &&
              last &&
              !preview.path &&
              !preview.blocked && (
                <line
                  x1={last.x}
                  y1={last.y}
                  x2={preview.tip.x}
                  y2={preview.tip.y}
                  stroke={p.style.color}
                  strokeOpacity={p.style.opacity ?? 1}
                  strokeWidth={p.style.width}
                  strokeDasharray="4 3"
                />
              )}
            <path
              d={preview.path}
              fill="none"
              stroke="#10212b"
              strokeOpacity={.65 * (p.style.opacity ?? 1)}
              strokeDasharray={preview.crossing ? '5 4' : undefined}
              strokeWidth={p.style.width + 1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={preview.path}
              fill="none"
              stroke={p.style.color}
              strokeOpacity={p.style.opacity ?? 1}
              strokeDasharray={preview.crossing ? '5 4' : undefined}
              strokeWidth={p.style.width}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <line
              x1={preview.tip.x}
              y1={preview.tip.y}
              x2={preview.finger.x}
              y2={preview.finger.y}
              stroke="#10212b"
              strokeWidth="3"
            />
            <line
              x1={preview.tip.x}
              y1={preview.tip.y}
              x2={preview.finger.x}
              y2={preview.finger.y}
              stroke="#a7efd0"
              strokeWidth="1"
            />
            <circle
              cx={preview.finger.x}
              cy={preview.finger.y}
              r="10"
              fill="#10212b99"
              stroke="#a7efd0"
              strokeWidth="1.5"
            />
            {preview.snapped && (
              <circle
                cx={preview.tip.x}
                cy={preview.tip.y}
                r="10"
                fill="#9de8c433"
                stroke="#a7efd0"
                strokeWidth="2"
              />
            )}
            <circle
              cx={preview.tip.x}
              cy={preview.tip.y}
              r="3"
              fill={p.style.color}
              stroke="white"
            />
            {preview.kind === 'aim' && (
              <path
                d={`M ${preview.tip.x - 10} ${preview.tip.y} h 7 m 6 0 h 7 M ${preview.tip.x} ${preview.tip.y - 10} v 7 m 0 6 v 7`}
                stroke="white"
                strokeWidth="1.5"
              />
            )}
          </g>
        )}
      </svg>
      {preview?.kind === 'aim' && (
        <PointMagnifier point={preview.tip} {...size} observe={p.magnify} />
      )}
      {p.distanceSegments && distanceTip && size.width > 0 && (
        <output className="track-draw-distance" aria-label="画线累计长度" style={{
          width: labelWidth,
          left: Math.max(4, Math.min(size.width-labelWidth-4, labelBelow
            ? (distanceTip.x-labelWidth-16>=4 ? distanceTip.x-labelWidth-16 : distanceTip.x+16)
            : distanceTip.x-labelWidth/2)),
          top: Math.max(4, Math.min(size.height-28, distanceTip.y+(labelBelow?12:-52))),
        }}>{distanceText}</output>
      )}
      {p.enabled && <div className="track-draw-hint glass" role="status">
        {instruction}
      </div>}
    </>
  );
});
