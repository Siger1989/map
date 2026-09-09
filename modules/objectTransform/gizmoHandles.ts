import type { Axis } from './math';
import type { Handle, Screen, Projector } from './projection';
export type Target = {
  key: string;
  handle: Handle;
  points: Screen[];
  label: string;
};
const distance = (p: Screen, a: Screen, b: Screen) => {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) /
          Math.max(1e-9, dx * dx + dy * dy),
      ),
    );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

export function gizmoHandles(
  p: Projector | null,
  kind: string,
  visible: boolean,
) {
  const c = p?.center;
  const targets: Target[] = [],
    rings: {
      key: string;
      points: Screen[];
      color: string;
      label: string;
      axis: Axis;
    }[] = [],
    axes: { axis: Axis; color: string; tip: Screen; box: Screen }[] = [];
  if (p && c && visible) {
    const colors = ['#ef5652', '#5fdf79', '#598fff'];
    for (let i = 0; i < 3; i++) {
      const axis = (['x', 'y', 'z'] as const)[i],
        v = p.axes[i],
        tip = p.project(v.clone().multiplyScalar(p.radius * 1.8)),
        box = p.project(v.clone().multiplyScalar(p.radius * 0.65));
      if (kind === 'pin' && axis === 'z') continue;
      axes.push({ axis, color: colors[i], tip, box });
      targets.push({
        key: `move-${axis}`,
        handle: { mode: 'move', axis },
        points: [tip],
        label: `沿${axis.toUpperCase()}轴移动`,
      });
      if (kind === 'pin' || kind === 'measurement-point') continue;
      const u = p.axes[(i + 1) % 3],
        w = p.axes[(i + 2) % 3];
      const points = Array.from({ length: 97 }, (_, j) =>
        p.project(
          u
            .clone()
            .multiplyScalar(Math.cos((j / 96) * Math.PI * 2) * p.radius)
            .addScaledVector(w, Math.sin((j / 96) * Math.PI * 2) * p.radius),
        ),
      );
      rings.push({
        key: `rotate-${axis}`,
        points,
        color: colors[i],
        label: `绕${axis.toUpperCase()}轴旋转`,
        axis,
      });
      targets.push({
        key: `rotate-${axis}`,
        handle: { mode: 'rotate', axis },
        points,
        label: `绕${axis.toUpperCase()}轴旋转`,
      });
      if (!(kind === 'plane' && axis === 'z'))
        targets.push({
          key: `scale-${axis}`,
          handle: { mode: 'scale', axis },
          points: [box],
          label: `沿${axis.toUpperCase()}轴拉伸`,
        });
    }
    if (kind !== 'pin' && kind !== 'measurement-point') {
      const points = Array.from({ length: 97 }, (_, j) => ({
        x: c.x + Math.cos((j / 96) * Math.PI * 2) * 96,
        y: c.y + Math.sin((j / 96) * Math.PI * 2) * 96,
      }));
      rings.unshift({
        key: 'rotate-free',
        points,
        color: '#d0d4d5',
        label: '沿屏幕方向旋转',
        axis: 'free',
      });
      targets.push(
        {
          key: 'rotate-free',
          handle: { mode: 'rotate', axis: 'free' },
          points,
          label: '沿屏幕方向旋转',
        },
        {
          key: 'scale-free',
          handle: { mode: 'scale', axis: 'free' },
          points: [c],
          label: '中心黄色方块等比缩放',
        },
      );
    }
    targets.push({
      key: 'move-free',
      handle: { mode: 'move', axis: 'free' },
      points: [{ x: c.x - 96, y: c.y - 96 }],
      label: '沿屏幕平面移动',
    });
  }
  return { targets, rings, axes };
}
export function nearestHandle(targets: Target[], from: Screen, key: string) {
  let best = targets.find((t) => t.key === key)!,
    score = Infinity;
  for (const t of targets) {
    const d =
      t.points.length === 1
        ? Math.hypot(from.x - t.points[0].x, from.y - t.points[0].y) - 4
        : Math.min(
            ...t.points.slice(1).map((b, i) => distance(from, t.points[i], b)),
          );
    if (d < score) {
      score = d;
      best = t;
    }
  }
  return best;
}
