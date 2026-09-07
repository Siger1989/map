import type { Contour, ProfilePoint } from './contours';
import { metreTicks, niceStep } from './scale.ts';
export function chartFrame(
  curves: Contour[],
  width: number,
  height: number,
  extra: ProfilePoint[] = [],
  font = 9,
  interval: number | 'auto' = 'auto',
) {
  const points = [...curves.flatMap((c) => c.points), ...extra],
    us = points.map((p) => p.u),
    vs = points.map((p) => p.v);
  const minU = points.length ? Math.min(...us) : -1,
    maxU = points.length ? Math.max(...us) : 1,
    minV = points.length ? Math.min(...vs) : -1,
    maxV = points.length ? Math.max(...vs) : 1;
  const left = font * 5,
    right = width - font * 2,
    top = font * 2,
    bottom = height - font * 3;
  const scale = Math.min(
    (right - left) / Math.max(1, maxU - minU),
    (bottom - top) / Math.max(1, maxV - minV),
  );
  const centerU = (minU + maxU) / 2,
    centerV = (minV + maxV) / 2;
  const uTicks = metreTicks(
      centerU - (right - left) / scale / 2,
      centerU + (right - left) / scale / 2,
      4,
      interval,
    ),
    vTicks = metreTicks(
      centerV - (bottom - top) / scale / 2,
      centerV + (bottom - top) / scale / 2,
      4,
      interval,
    );
  return {
    x: (p: Pick<ProfilePoint, 'u'>) =>
      (left + right) / 2 + (p.u - centerU) * scale,
    y: (p: Pick<ProfilePoint, 'v'>) =>
      (top + bottom) / 2 - (p.v - centerV) * scale,
    minU,
    maxU,
    minV,
    maxV,
    left,
    right,
    top,
    bottom,
    uTicks,
    vTicks,
    scale,
    bar: niceStep((right - left) / scale, 8),
  };
}
