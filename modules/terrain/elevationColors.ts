import type { ExpressionSpecification } from 'maplibre-gl';

// Stable absolute-elevation palette anchors shared with the native terrain renderer.
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
export const ELEVATION_FILL_STEP_METERS = 25;

function interpolatedBandColor(band: number) {
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
        Math.max(0, Math.min(255, Math.round(
          parseInt(from.slice(offset, offset + 2), 16) * (1 - fraction) +
          parseInt(to.slice(offset, offset + 2), 16) * fraction,
        )))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export function elevationColor(height: number, step = ELEVATION_STEP) {
  const band = Math.floor(height / step) * step;
  return interpolatedBandColor(band);
}

/** Fixed 25 m fill palette; contour interval does not change terrain colors. */
export function elevationFillColor(heightMeters: number) {
  return interpolatedBandColor(Math.floor(heightMeters / ELEVATION_FILL_STEP_METERS) * ELEVATION_FILL_STEP_METERS);
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
export const ELEVATION_FILL_COLORS_25 = elevationColorsForInterval(ELEVATION_FILL_STEP_METERS);
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
const fillExpression = [
  'interpolate',
  ['linear'],
  ['elevation'],
  ...ELEVATION_FILL_COLORS_25.flatMap(([height, color], index) =>
    index === 0
      ? [height, color]
      : [height - 0.25, ELEVATION_FILL_COLORS_25[index - 1][1], height, color],
  ),
] as ExpressionSpecification;
export const elevationFillExpression = fillExpression;

function relativeLuminance(color: string) {
  const channels = [1, 3, 5].map((offset) => parseInt(color.slice(offset, offset + 2), 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

/** Select pure black/white using WCAG contrast against the fixed fill palette. */
export function contrastContourColor(heightMeters: number) {
  const luminance = relativeLuminance(elevationFillColor(heightMeters));
  const blackContrast = (luminance + 0.05) / 0.05;
  const whiteContrast = 1.05 / (luminance + 0.05);
  return whiteContrast >= blackContrast ? '#FFFFFF' : '#000000';
}

const contrastContourExpression: ExpressionSpecification = [
  'step',
  ['to-number', ['get', 'ele']],
  contrastContourColor(ELEVATION_FILL_COLORS_25[0][0]),
  ...ELEVATION_FILL_COLORS_25.slice(1).flatMap(([height]) => [height, contrastContourColor(height)]),
];

export const highContrastContourColorExpression = contrastContourExpression;
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
