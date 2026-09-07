import { useEffect, useRef, useState } from 'react';
import type { PhotoStroke } from './details';
type Point = { x: number; y: number };
const clamp = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, n));
/** One image coordinate system for zoom, rotated display, saved ink and export. */
export function PhotoStage({
  url,
  name,
  rotation,
  strokes,
  drawing,
  color,
  onStrokes,
}: {
  url: string;
  name: string;
  rotation: number;
  strokes: PhotoStroke[];
  drawing: boolean;
  color: PhotoStroke['color'];
  onStrokes: (value: PhotoStroke[]) => void;
}) {
  const host = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 }),
    [image, setImage] = useState({ width: 1, height: 1 });
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const pointers = useRef(new Map<number, Point>()),
    activeStroke = useRef<number | null>(null);
  const swapped = rotation % 180 !== 0;
  const fit = Math.min(
    size.width / (swapped ? image.height : image.width),
    size.height / (swapped ? image.width : image.height),
  );
  const width = image.width * fit,
    height = image.height * fit;
  const bound = (v: typeof view) => ({
    ...v,
    x: clamp(
      v.x,
      -Math.max(0, ((swapped ? height : width) * v.scale - size.width) / 2),
      Math.max(0, ((swapped ? height : width) * v.scale - size.width) / 2),
    ),
    y: clamp(
      v.y,
      -Math.max(0, ((swapped ? width : height) * v.scale - size.height) / 2),
      Math.max(0, ((swapped ? width : height) * v.scale - size.height) / 2),
    ),
  });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      });
      setView({ scale: 1, x: 0, y: 0 });
    });
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 });
    pointers.current.clear();
    activeStroke.current = null;
  }, [url, rotation, drawing]);
  const imagePoint = (x: number, y: number): [number, number] => {
    const matrix = svg.current?.getScreenCTM();
    const p = matrix
      ? new DOMPoint(x, y).matrixTransform(matrix.inverse())
      : { x: 0, y: 0 };
    return [clamp(p.x / image.width, 0, 1), clamp(p.y / image.height, 0, 1)];
  };
  const zoom = (factor: number) =>
    setView((v) => bound({ ...v, scale: clamp(v.scale * factor, 1, 6) }));
  return (
    <div className="photo-stage-wrap">
      <div
        ref={host}
        className="photo-stage"
        aria-label="照片缩放画布"
        onDoubleClick={() => {
          if (!drawing)
            setView((v) => ({ scale: v.scale === 1 ? 2 : 1, x: 0, y: 0 }));
        }}
        onWheel={(e) => {
          e.stopPropagation();
          zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15);
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (drawing && pointers.current.size === 1 && strokes.length < 80) {
            activeStroke.current = strokes.length;
            onStrokes([
              ...strokes,
              { color, points: [imagePoint(e.clientX, e.clientY)] },
            ]);
          }
        }}
        onPointerMove={(e) => {
          const old = pointers.current.get(e.pointerId);
          if (!old) return;
          const before = [...pointers.current.values()];
          pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (drawing) {
            if (pointers.current.size !== 1 || activeStroke.current === null)
              return;
            const i = activeStroke.current;
            onStrokes(
              strokes.map((s, n) =>
                n !== i || s.points.length >= 400
                  ? s
                  : {
                      ...s,
                      points: [...s.points, imagePoint(e.clientX, e.clientY)],
                    },
              ),
            );
            return;
          }
          const after = [...pointers.current.values()];
          if (after.length === 1)
            setView((v) =>
              bound({
                ...v,
                x: v.x + e.clientX - old.x,
                y: v.y + e.clientY - old.y,
              }),
            );
          else if (after.length === 2) {
            const distance = (p: Point[]) =>
              Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
            const rect = host.current!.getBoundingClientRect();
            const mid = (p: Point[]) => ({
              x: (p[0].x + p[1].x) / 2 - rect.left - rect.width / 2,
              y: (p[0].y + p[1].y) / 2 - rect.top - rect.height / 2,
            });
            setView((v) => {
              const scale = clamp(
                  (v.scale * distance(after)) / Math.max(1, distance(before)),
                  1,
                  6,
                ),
                a = mid(before),
                b = mid(after);
              return bound({
                scale,
                x: b.x - ((a.x - v.x) * scale) / v.scale,
                y: b.y - ((a.y - v.y) * scale) / v.scale,
              });
            });
          }
        }}
        onPointerUp={(e) => {
          pointers.current.delete(e.pointerId);
          activeStroke.current = null;
        }}
        onPointerCancel={(e) => {
          pointers.current.delete(e.pointerId);
          activeStroke.current = null;
        }}
      >
        <div
          className="photo-image-plane"
          style={{
            width,
            height,
            transform: `translate(-50%, -50%) translate(${view.x}px, ${view.y}px) scale(${view.scale}) rotate(${rotation}deg)`,
          }}
        >
          <img
            src={url}
            alt={name}
            draggable={false}
            onLoad={(e) =>
              setImage({
                width: e.currentTarget.naturalWidth,
                height: e.currentTarget.naturalHeight,
              })
            }
          />
          <svg
            ref={svg}
            viewBox={`0 0 ${image.width} ${image.height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {strokes.map((s, i) =>
              s.points.length === 1 ? (
                <circle
                  key={i}
                  cx={s.points[0][0] * image.width}
                  cy={s.points[0][1] * image.height}
                  r={Math.max(image.width, image.height) / 400}
                  fill={s.color}
                />
              ) : (
                <polyline
                  key={i}
                  points={s.points
                    .map((p) => `${p[0] * image.width},${p[1] * image.height}`)
                    .join(' ')}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={Math.max(image.width, image.height) / 200}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ),
            )}
          </svg>
        </div>
      </div>
      <div className="photo-zoom-tools">
        <button aria-label="缩小照片" onClick={() => zoom(1 / 1.5)}>
          −
        </button>
        <output aria-label="照片缩放倍率">
          {Math.round(view.scale * 100)}%
        </output>
        <button aria-label="放大照片" onClick={() => zoom(1.5)}>
          ＋
        </button>
        <button onClick={() => setView({ scale: 1, x: 0, y: 0 })}>
          适应屏幕
        </button>
        <small>
          {drawing ? '单指画线，保存后可缩放' : '双指缩放 · 放大后拖动'}
        </small>
      </div>
    </div>
  );
}
