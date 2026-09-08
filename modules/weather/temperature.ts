import { GRID_STEP, type WeatherData } from './data.ts';

export const TEMPERATURE_COLORS = [
  [-30, '#6a4ba5'],
  [-20, '#596ad4'],
  [-10, '#3e9ce0'],
  [0, '#22c9dd'],
  [10, '#32bf64'],
  [20, '#f4cf32'],
  [30, '#f58321'],
  [40, '#e93843'],
  [50, '#9b265d'],
] as const;
export function temperatureFeatures(
  data: WeatherData | null,
  index: number,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: (data?.cells ?? []).flatMap((cell) => {
      const value = cell.hours[index]?.temperature;
      if (value == null || !Number.isFinite(value)) return [];
      const half = GRID_STEP / 2,
        south = Math.max(-85, cell.lat - half),
        north = Math.min(85, cell.lat + half);
      if (north <= south) return [];
      return [
        {
          type: 'Feature' as const,
          properties: { temperature: value },
          geometry: {
            type: 'Polygon' as const,
            coordinates: [
              [
                [cell.lng - half, south],
                [cell.lng + half, south],
                [cell.lng + half, north],
                [cell.lng - half, north],
                [cell.lng - half, south],
              ],
            ],
          },
        },
      ];
    }),
  };
}
