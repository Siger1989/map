'use client';
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent,
  type KeyboardEvent,
} from 'react';
import type { Pose } from './math';
import {
  objectProjector,
  transformAt,
  type ProjectionFrame,
  type WatchProjection,
  type Projector,
  type Handle,
  type Screen,
} from './projection';
import { gizmoHandles, nearestHandle } from './gizmoHandles';

type Props = {
  name: string;
  kind: string;
  pose: Pose;
  watchProjection: WatchProjection;
  canUndo: boolean;
  error?: string;
  onBegin: () => void;
  onPreview: (p: Pose | null) => void;
  onCommit: (p: Pose) => void;
  onUndo: () => void;
  onDetails: () => void;
  onClose: () => void;
  onLocate: () => void;
};
/** Object-centred universal Gizmo: arrows, rings and boxes are live together. */
export function ObjectGizmo(props: Props) {
  const [frame, setFrame] = useState<ProjectionFrame | null>(null),
    [active, setActive] = useState('');
  const latest = useRef(props);
  latest.current = props;
  const gesture = useRef<{
    id: number;
    from: Screen;
    pose: Pose;
    projector: Projector;
    handle: Handle;
    next: Pose;
    moved: boolean;
  } | null>(null);
  const svg = useRef<SVGSVGElement>(null),
    lastFrame = useRef('');
  const finish = (commit: boolean) => {
    const g = gesture.current;
    if (!g) return;
    gesture.current = null;
    setActive('');
    if (commit && g.moved) latest.current.onCommit(g.next);
    latest.current.onPreview(null);
  };
  useEffect(
    () =>
      props.watchProjection((f) => {
        const key = f.matrix.join(',') + f.width + ':' + f.height;
        if (lastFrame.current !== key) {
          lastFrame.current = key;
          setFrame(f);
        }
      }),
    [props.watchProjection],
  );
  useEffect(() => {
    const cancel = () => finish(false),
      escape = (e: globalThis.KeyboardEvent) => {
        if (e.key === 'Escape' && gesture.current) {
          e.preventDefault();
          e.stopImmediatePropagation();
          cancel();
        }
      };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', escape, true);
    const anotherPointer = (e: globalThis.PointerEvent) => {
      if (gesture.current && e.pointerId !== gesture.current.id) cancel();
    };
    window.addEventListener('pointerdown', anotherPointer, true);
    return () => {
      window.removeEventListener('blur', cancel);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('pointerdown', anotherPointer, true);
      if (gesture.current) {
        gesture.current = null;
        latest.current.onPreview(null);
      }
    };
  }, []);
  const p = frame ? objectProjector(frame, props.pose) : null,
    c = p?.center;
  const visible = !!(
    p &&
    c?.visible &&
    frame &&
    c.x > -100 &&
    c.x < frame.width + 100 &&
    c.y > 0 &&
    c.y < frame.height - 70
  );
  const { targets, rings, axes } = gizmoHandles(p, props.kind, visible);
  const screen = (e: PointerEvent<SVGElement>) => {
    const rect = svg.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };
  const begin = (e: PointerEvent<SVGElement>, key: string) => {
    if (!p || !e.isPrimary || e.button !== 0 || gesture.current) return;
    const from = screen(e);
    // Nearest handle wins at ring intersections, with point handles above line hits.
    const best = nearestHandle(targets, from, key);
    e.preventDefault();
    e.stopPropagation();
    svg.current!.setPointerCapture(e.pointerId);
    gesture.current = {
      id: e.pointerId,
      from,
      pose: props.pose,
      projector: p,
      handle: best.handle,
      next: props.pose,
      moved: false,
    };
    setActive(best.label);
    props.onBegin();
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    const to = screen(e);
    if (Math.hypot(to.x - g.from.x, to.y - g.from.y) < 2 && !g.moved) return;
    g.moved = true;
    g.next = transformAt(
      g.pose,
      g.projector,
      g.handle,
      g.from,
      to,
      props.kind,
      e.shiftKey,
    );
    props.onPreview(g.next);
  };
  const keyboard = (e: KeyboardEvent<SVGGElement>, key: string) => {
    const t = targets.find((t) => t.key === key);
    if (
      !p ||
      !t ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
    )
      return;
    e.preventDefault();
    e.stopPropagation();
    props.onBegin();
    const from = t.points[0];
    props.onCommit(
      transformAt(
        props.pose,
        p,
        t.handle,
        from,
        {
          x:
            from.x +
            (e.key === 'ArrowLeft' ? -8 : e.key === 'ArrowRight' ? 8 : 0),
          y:
            from.y + (e.key === 'ArrowUp' ? -8 : e.key === 'ArrowDown' ? 8 : 0),
        },
        props.kind,
        e.shiftKey,
      ),
    );
  };
  const handlers = (key: string, label: string) => ({
    role: 'button',
    tabIndex: 0,
    'aria-label': label,
    onPointerDown: (e: PointerEvent<SVGElement>) => begin(e, key),
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => keyboard(e, key),
  });
  const path = (points: Screen[]) =>
    points
      .map((a, i) => `${i ? 'L' : 'M'}${a.x.toFixed(2)},${a.y.toFixed(2)}`)
      .join(' ');
  return (
    <>
      <svg
        ref={svg}
        className="object-gizmo-canvas"
        aria-label={`${props.name}三维操控器`}
        data-active={!!active}
        onPointerMove={move}
        onPointerUp={(e) => {
          if (e.pointerId === gesture.current?.id) finish(true);
        }}
        onPointerCancel={() => finish(false)}
        onLostPointerCapture={() => finish(false)}
        onClick={(e) => e.stopPropagation()}
      >
        {visible && p && c && (
          <>
            {rings.map((r) => (
              <g key={r.key} {...handlers(r.key, r.label)}>
                <path className="gizmo-hit-ring" d={path(r.points)} />
                <path className="gizmo-line-shadow" d={path(r.points)} />
                <path
                  className="gizmo-line"
                  d={path(r.points)}
                  stroke={r.color}
                />
              </g>
            ))}
            {axes.map((a) => {
              const dx = a.tip.x - c.x,
                dy = a.tip.y - c.y,
                angle = (Math.atan2(dy, dx) * 180) / Math.PI;
              return (
                <g key={a.axis}>
                  <path
                    className="gizmo-line-shadow"
                    d={`M${c.x},${c.y} L${a.tip.x},${a.tip.y}`}
                  />
                  <path
                    className="gizmo-line"
                    stroke={a.color}
                    d={`M${c.x},${c.y} L${a.tip.x},${a.tip.y}`}
                  />
                  <g
                    {...handlers(
                      `move-${a.axis}`,
                      `沿${a.axis.toUpperCase()}轴移动`,
                    )}
                  >
                    <circle
                      className="gizmo-hit"
                      cx={a.tip.x}
                      cy={a.tip.y}
                      r="22"
                    />
                    <path
                      className="gizmo-solid"
                      transform={`translate(${a.tip.x} ${a.tip.y}) rotate(${angle})`}
                      d="M13 0 L-15 -10 L-15 10 Z"
                      fill={a.color}
                    />
                  </g>
                  {props.kind !== 'pin' &&
                    !(props.kind === 'plane' && a.axis === 'z') && (
                      <g
                        {...handlers(
                          `scale-${a.axis}`,
                          `沿${a.axis.toUpperCase()}轴拉伸`,
                        )}
                      >
                        <rect
                          className="gizmo-hit"
                          x={a.box.x - 22}
                          y={a.box.y - 22}
                          width="44"
                          height="44"
                        />
                        <rect
                          className="gizmo-solid"
                          x={a.box.x - 8}
                          y={a.box.y - 8}
                          width="16"
                          height="16"
                          fill={a.color}
                        />
                      </g>
                    )}
                  <text
                    className="gizmo-axis-label"
                    x={a.tip.x + 13}
                    y={a.tip.y - 10}
                    fill={a.color}
                  >
                    {a.axis.toUpperCase()}
                  </text>
                </g>
              );
            })}
            {props.kind !== 'pin' && (
              <g {...handlers('scale-free', '中心黄色方块等比缩放')}>
                <rect
                  className="gizmo-hit"
                  x={c.x - 22}
                  y={c.y - 22}
                  width="44"
                  height="44"
                />
                <rect
                  className="gizmo-solid"
                  x={c.x - 11}
                  y={c.y - 11}
                  width="22"
                  height="22"
                  fill="#ddcd4d"
                />
                <rect
                  x={c.x - 4}
                  y={c.y - 4}
                  width="8"
                  height="8"
                  fill="#26393d"
                  pointerEvents="none"
                />
              </g>
            )}
            <g {...handlers('move-free', '沿屏幕平面移动')}>
              <rect
                className="gizmo-hit"
                x={c.x - 118}
                y={c.y - 118}
                width="44"
                height="44"
              />
              <path
                className="gizmo-solid"
                d={`M${c.x - 108} ${c.y - 108} h23 l-8 8 h-7 v7 l-8 8 Z`}
                fill="#d0d4d5"
              />
            </g>
          </>
        )}
      </svg>
      <aside
        className="object-gizmo glass"
        aria-label={`${props.name}操作栏`}
        data-active={!!active}
      >
        <header>
          <strong title={props.name}>{props.name}</strong>
          <button
            disabled={!!active}
            onClick={props.onDetails}
            aria-label="查看对象详情"
          >
            详情
          </button>
          <button
            disabled={!!active}
            onClick={props.onClose}
            aria-label="结束对象操作"
          >
            ✓
          </button>
        </header>
        <div className="object-gizmo-actions">
          <button
            disabled={!!active || !props.canUndo}
            onClick={props.onUndo}
            aria-label="撤销对象变换"
          >
            撤销
          </button>
          <button disabled={!!active} onClick={props.onLocate}>
            回到对象
          </button>
          {active ? (
            <button onClick={() => finish(false)}>取消</button>
          ) : (
            <span>
              箭头移动 · 圆环旋转
              <br />
              方块拉伸 · 黄块等比
            </span>
          )}
        </div>
        {active && <small>{active} · 松手保存 / Esc 取消</small>}
        {!visible && <small>对象在视野外，可点“回到对象”。</small>}
        {props.error && <p role="alert">{props.error}</p>}
      </aside>
    </>
  );
}
