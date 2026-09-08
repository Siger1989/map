import type { ExpressionSpecification } from 'maplibre-gl';

// Major palette anchors remain compatible; each 50 m contour gets its own shade.
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
export function elevationColor(height: number) {
  const band = Math.floor(height / ELEVATION_STEP) * ELEVATION_STEP;
  const index = ELEVATION_COLORS.findIndex(([h]) => h > band);
  if (index === 0) return ELEVATION_COLORS[0][1];
  if (index < 0) return ELEVATION_COLORS.at(-1)![1];
  const [low, a] = ELEVATION_COLORS[index - 1],
    [high, b] = ELEVATION_COLORS[index];
  const t = (band - low) / (high - low);
  return (
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(a.slice(i, i + 2), 16) * (1 - t) +
            parseInt(b.slice(i, i + 2), 16) * t,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export const ELEVATION_FINE_COLORS = Array.from({ length: 191 }, (_, i) => {
  const height = -500 + i * ELEVATION_STEP;
  return [height, elevationColor(height)] as const;
});
export const elevationExpression: ExpressionSpecification = [
  // MapLibre 6.7 color-relief only renders Interpolate expressions. Paired
  // stops keep each 50 m band solid, with a sub-metre boundary transition.
  'interpolate',
  ['linear'],
  ['elevation'],
  ...ELEVATION_FINE_COLORS.flatMap(([height, color], index) =>
    index === 0
      ? [height, color]
      : [height - 0.25, ELEVATION_FINE_COLORS[index - 1][1], height, color],
  ),
];
export const contourColorExpression: ExpressionSpecification = [
  'step',
  ['to-number', ['get', 'ele']],
  ELEVATION_FINE_COLORS[0][1],
  ...ELEVATION_FINE_COLORS.flatMap(([height, color]) => [height, color]),
];
