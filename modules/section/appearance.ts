import type { ExpressionSpecification } from 'maplibre-gl';
export const sectionColor = (color?: string) =>
  /^#[0-9a-f]{6}$/i.test(color ?? '') ? color! : '#ffffff';
export function sectionOutline(color?: string): string {
  const value = sectionColor(color);
  const rgb = [1, 3, 5].map((index) =>
    parseInt(value.slice(index, index + 2), 16),
  );
  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 145
    ? '#334155'
    : '#ffffff';
}
export function sectionFill(
  altitude: number,
  color?: string,
): ExpressionSpecification {
  // MapLibre's color-relief renderer builds its GPU ramp from Interpolate only.
  // A 10cm transition hides quantization at the boundary; the cut face is one solid color.
  return [
    'interpolate',
    ['linear'],
    ['elevation'],
    altitude - 0.1,
    'rgba(0,0,0,0)',
    altitude,
    sectionColor(color),
  ];
}
