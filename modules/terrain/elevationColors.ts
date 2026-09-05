import type { ExpressionSpecification } from 'maplibre-gl';

// Discrete altitude bands share exact thresholds with the legend, in real metres.
export const ELEVATION_COLORS = [
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
] as const;
export const elevationExpression: ExpressionSpecification = [
  // MapLibre 6.7 color-relief only renders Interpolate expressions. Paired
  // stops keep each 500 m band solid, with a sub-metre boundary transition.
  'interpolate',
  ['linear'],
  ['elevation'],
  ...ELEVATION_COLORS.flatMap(([height, color], index) =>
    index === 0
      ? [height, color]
      : [height - 0.25, ELEVATION_COLORS[index - 1][1], height, color],
  ),
];
