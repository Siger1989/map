import type { ExpressionSpecification } from 'maplibre-gl';

// Stable palette anchors; the user-selected contour interval sets the band size.
export const ELEVATION_COLORS = [
  [-500, '#075043'],
  [0, '#137b63'],
  [500, '#47ba42'],
  [1000, '#b5dd2a'],
  [1500, '#ffe02e'],
  [2000, '#ffa326'],
  [2500, '#ec591e'],
  [3000, '#d52042'],
  [3500, '#ab286e'],
  [4000, '#7b45a1'],
  [4500, '#4b57b1'],
  [5000, '#8794d3'],
  [6000, '#f4f6ff'],
  [9000, '#afc5db'],
] as const;

export const ELEVATION_STEP = 50;

export function elevationColor(height: number, step = ELEVATION_STEP) {
  const band = Math.floor(height / step) * step;
  const index = ELEVATION_COLORS.findIndex(([anchor]) => anchor > band);
  if (index === 0) return ELEVATION_COLORS[0][1];
  if (index < 0) return ELEVATION_COLORS.at(-1)![1];
  const [low, from] = ELEVATION_COLORS[index - 1];
  const [high, to] = ELEVATION_COLORS[index];
  const fraction = (band - low) / (high - low);
  return (
    '#' +
    [1, 3, 5]
      .map((offset) =>
        Math.round(
          parseInt(from.slice(offset, offset + 2), 16) * (1 - fraction) +
            parseInt(to.slice(offset, offset + 2), 16) * fraction,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export function elevationColorsForInterval(interval: number) {
  const colors: (readonly [number, string])[] = [];
  const firstBand = Math.floor(-500 / interval) * interval;
  for (let height = firstBand; height < 9000; height += interval)
    colors.push([height, elevationColor(height, interval)]);
  if (colors.at(-1)?.[0] !== 9000)
    colors.push([9000, elevationColor(9000, interval)]);
  return colors;
}

export const ELEVATION_FINE_COLORS = elevationColorsForInterval(ELEVATION_STEP);
const elevationExpressionCache = new Map<number, ExpressionSpecification>();

export function elevationExpressionForInterval(interval: number): ExpressionSpecification {
  const cached = elevationExpressionCache.get(interval);
  if (cached) return cached;
  const colors = elevationColorsForInterval(interval);
  const expression = [
    'interpolate',
    ['linear'],
    ['elevation'],
    ...colors.flatMap(([height, color], index) =>
      index === 0
        ? [height, color]
        : [height - 0.25, colors[index - 1][1], height, color],
    ),
  ] as ExpressionSpecification;
  elevationExpressionCache.set(interval, expression);
  return expression;
}

export const elevationExpression = elevationExpressionForInterval(ELEVATION_STEP);
const contourExpressionCache = new Map<number, ExpressionSpecification>();

export function contourColorExpressionForInterval(interval: number): ExpressionSpecification {
  const cached = contourExpressionCache.get(interval);
  if (cached) return cached;
  const colors = elevationColorsForInterval(interval);
  const expression = [
    'step',
    ['to-number', ['get', 'ele']],
    colors[0][1],
    ...colors.flatMap(([height, color]) => [height, color]),
  ] as ExpressionSpecification;
  contourExpressionCache.set(interval, expression);
  return expression;
}

export const contourColorExpression = contourColorExpressionForInterval(ELEVATION_STEP);
