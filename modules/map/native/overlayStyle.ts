import type { Feature } from 'geojson';

/** React/MapLibre's route outline paint, serialized as an ordinary native path. */
export function trackOutlineFeature(feature: Feature): Feature {
  const properties = feature.properties ?? {};
  const selected = properties.selected === true;
  const width = typeof properties.width === 'number' ? properties.width : 2;
  const opacity = typeof properties.opacity === 'number' ? properties.opacity : 1;
  return {
    ...feature,
    properties: {
      ...properties,
      role: 'trackHalo',
      color: selected ? '#ffffff' : '#10212b',
      width: width + (selected ? 2 : 1),
      opacity: opacity * 0.65,
    },
  };
}
