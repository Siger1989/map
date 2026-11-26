import type { PrintSelection } from './selection';

const SCALE = Math.PI / 180;

export function selectionGroundSize({ bounds: { west, east, south, north } }: PrintSelection) {
  const latitude = (south + north) * SCALE / 2;
  const eccentricitySquared = 0.00669437999014;
  const axis = Math.sqrt(1 - eccentricitySquared * Math.sin(latitude) ** 2);
  return {
    width: (east - west) * SCALE * 6_378_137 * Math.cos(latitude) / axis,
    height: (north - south) * SCALE * 6_378_137 * (1 - eccentricitySquared) / axis ** 3,
  };
}
