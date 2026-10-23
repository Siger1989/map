import type { Map } from 'maplibre-gl';

type SkySpecification = NonNullable<Parameters<Map['setSky']>[0]>;

/** Clear daytime sky with a bright horizon and a gradual blue overhead. */
export const CLEAR_DAY_SKY: SkySpecification = {
  'sky-color': '#69b9e8',
  'horizon-color': '#ffffff',
  'fog-color': '#e5eff5',
  'sky-horizon-blend': 0.65,
  'horizon-fog-blend': 0.78,
  'fog-ground-blend': 0.85,
  'atmosphere-blend': 1,
};

/** Apply after the map style has loaded. */
export function applyClearDaySky(map: Map): void {
  map.setSky(CLEAR_DAY_SKY);
}
