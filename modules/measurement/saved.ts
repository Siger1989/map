import { MAX_POINTS, validPoint, type MeasurePoint } from './data.ts';

export const SAVED_MEASUREMENTS_KEY = 'shantu.measurement.saved.v1';
export type SavedMeasurement = {
  id: string;
  name: string;
  points: MeasurePoint[];
  updatedAt: number;
};
export function parseSavedMeasurements(raw: string | null): SavedMeasurement[] {
  if (!raw) return [];
  const data = JSON.parse(raw);
  if (
    data?.version !== 1 ||
    !Array.isArray(data.items) ||
    data.items.length > 200 ||
    !data.items.every(
      (item: SavedMeasurement) =>
        item &&
        typeof item.id === 'string' &&
        item.id.length > 0 &&
        item.id.length <= 100 &&
        typeof item.name === 'string' &&
        item.name.trim().length > 0 &&
        item.name.length <= 100 &&
        Number.isFinite(item.updatedAt) &&
        Array.isArray(item.points) &&
        item.points.length >= 2 &&
        item.points.length <= MAX_POINTS &&
        item.points.every(validPoint) &&
        new Set(item.points.map((p) => p.id)).size === item.points.length,
    ) ||
    new Set(data.items.map((item: SavedMeasurement) => item.id)).size !==
      data.items.length
  )
    throw new Error('已保存测量无法读取，原数据未覆盖');
  return data.items;
}
export const copyPoints = (points: MeasurePoint[]): MeasurePoint[] => {
  if (
    points.length < 2 ||
    points.length > MAX_POINTS ||
    !points.every(validPoint) ||
    new Set(points.map((p) => p.id)).size !== points.length
  )
    throw new Error('请至少选择两个不同的测量点');
  return points.map((p) => ({ ...p, coordinates: [...p.coordinates] }));
};
export function saveMeasurement(
  items: SavedMeasurement[],
  points: MeasurePoint[],
  id: string,
  now: number,
): SavedMeasurement[] {
  const pair = copyPoints(points),
    existing = items.find((item) => item.id === id);
  if (!existing && items.length >= 200)
    throw new Error('最多保存 200 组测量，请先移除不需要的测量');
  const number =
    Math.max(
      0,
      ...items.map((item) => Number(/^测量 (\d+)$/.exec(item.name)?.[1]) || 0),
    ) + 1;
  const record = {
    id,
    name: existing?.name ?? `测量 ${number}`,
    points: pair,
    updatedAt: now,
  };
  return existing
    ? items.map((item) => (item.id === id ? record : item))
    : [...items, record];
}
export function writeSavedMeasurements(
  storage: Pick<Storage, 'setItem'>,
  items: SavedMeasurement[],
) {
  const raw = JSON.stringify({ version: 1, items });
  parseSavedMeasurements(raw);
  storage.setItem(SAVED_MEASUREMENTS_KEY, raw);
}
