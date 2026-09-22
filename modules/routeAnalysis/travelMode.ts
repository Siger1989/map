export const TRAVEL_MODES = { walk: '步行', run: '跑步', bicycle: '自行车', motorcycle: '摩托车', car: '汽车' } as const;
export type TravelMode = keyof typeof TRAVEL_MODES;
export const normalizeTravelMode = (value: unknown): TravelMode => typeof value === 'string' && Object.hasOwn(TRAVEL_MODES, value) ? value as TravelMode : 'walk';
const limits: Record<TravelMode, number[]> = {
  walk: [2, 4, 6, 8], run: [5, 8, 12, 16], bicycle: [10, 20, 30, 40],
  motorcycle: [20, 40, 60, 80], car: [20, 40, 60, 100],
};
const colors = ['#16853b', '#60a7ad', '#dba51d', '#ed782a', '#d73c51'];
/** Comparison bands, not speed limits or safety ratings. */
export function speedBands(mode?: TravelMode) {
  const values = [...limits[normalizeTravelMode(mode)], Infinity];
  return values.map((maximum, i) => ({ maximum, color: colors[i], label: maximum === Infinity ? `≥${values[i-1]}` : `${i ? values[i-1] : 0}–${maximum}` }));
}
export function speedColor(speed: number | null, mode?: TravelMode) {
  return speed === null || !Number.isFinite(speed) ? '#8b9699' : speedBands(mode).find(b => speed < b.maximum)!.color;
}
