import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import type { Coordinate } from '../navigation/types';
import type { ScreenPoint } from './drawing';
import type { DrawingInput } from './DrawingGestureBridge';
import type { TrackStyle } from './style';
import type { DrawingMode } from './draft';
import { DrawingSession, type DrawingPreview } from './DrawingSession';
import { handlePoint } from './precision';
import { PointMagnifier, type MagnifierObserver } from './PointMagnifier';
import type { RoadSnapper } from './roadSnapping';
export type TrackDrawingHandle = { input: (event: DrawingInput) => void };

/** Visual-only overlay: touches continue to the map's native two-finger handlers. */
export const TrackDrawing = forwardRef<
  TrackDrawingHandle,
  {
    enabled: boolean;
    length: number;
    style: TrackStyle;
    mode: DrawingMode;
    anchor: Coordinate | null;
    candidates: Coordinate[];
    snapping: boolean;
    roadSnapping: boolean;
    snapRoad: RoadSnapper;
    lastVertex: Coordinate | null;
    toCoordinate: (point: ScreenPoint) => Coordinate | null;
    toScreen: (point: Coordinate) => ScreenPoint | null;
    magnify: MagnifierObserver;
    onAnchor: (point: Coordinate) => void;
    onVertex: (point: Coordinate) => void;
    onStroke: (points: Coordinate[]) => void;
  }
>(function TrackDrawing(p, ref) {
  const svg = useRef<SVGSVGElement>(null),
    session = useRef(new DrawingSession());
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [preview, setPreview] = useState<DrawingPreview | null>(null),
    [hint, setHint] = useState('');
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
  }, [p.mode, p.anchor]);
  useImperativeHandle(ref, () => ({
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
        snapRoad: p.snapRoad,
        project: p.toScreen,
        unproject: p.toCoordinate,
      });
      setPreview(result.preview);
      setHint(result.hint);
      if (result.anchor) p.onAnchor(result.anchor);
      if (result.vertex) p.onVertex(result.vertex);
      if (result.stroke) p.onStroke(result.stroke);
    },
  }));
  if (!p.enabled) return null;
  const anchor = p.anchor && p.toScreen(p.anchor),
    handle = anchor && handlePoint(anchor, p.length, size.height);
  const last = p.lastVertex && p.toScreen(p.lastVertex);
  const instruction =
    hint ||
    (p.mode === 'points'
      ? '准星定点 · 松手连接 · 双指控图'
      : p.anchor
        ? '② 起点已定：按住绿色环拖动即可画线'
        : '① 按住地图移动准星，松手只确认起点');
  return (
    <>
      <svg ref={svg} className="track-drawing" aria-hidden="true">
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
            {preview.kind === 'aim' && p.mode === 'points' && last && (
              <line
                x1={last.x}
                y1={last.y}
                x2={preview.tip.x}
                y2={preview.tip.y}
                stroke={p.style.color}
                strokeWidth={p.style.width}
                strokeDasharray="4 3"
              />
            )}
            <path
              d={preview.path}
              fill="none"
              stroke="#10212b"
              strokeOpacity=".65"
              strokeWidth={p.style.width + 1}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={preview.path}
              fill="none"
              stroke={p.style.color}
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
      <div className="track-draw-hint glass" role="status">
        {instruction}
      </div>
    </>
  );
});
