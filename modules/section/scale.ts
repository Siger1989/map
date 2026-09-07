/** Metres in the section plane, independent of terrain exaggeration or screen zoom. */
export const SECTION_SIZES = [100, 200, 500, 1000, 2000, 5000, 10000];
export function niceStep(span: number, divisions = 5) {
  if (!Number.isFinite(span) || span <= 0) return 1;
  const raw = span / Math.max(1, divisions),
    power = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 5, 10].find((n) => n * power >= raw) ?? 10) * power;
}
export function metreTicks(
  min: number,
  max: number,
  divisions = 5,
  interval: number | 'auto' = 'auto',
) {
  // Crowded rulers show multiples of the requested base interval.
  const requested =
    typeof interval === 'number' && Number.isFinite(interval) && interval > 0
      ? interval
      : niceStep(max - min, divisions);
  const step =
      requested * Math.max(1, Math.ceil((max - min) / (requested * 12))),
    ticks: number[] = [];
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min)
    return { step, ticks };
  for (
    let i = Math.ceil(min / step);
    i * step <= max + step * 1e-8 && ticks.length < 20;
    i++
  )
    ticks.push(Number((i * step).toPrecision(12)));
  return { step, ticks };
}
export const metreLabel = (n: number) => Number(n.toFixed(4)).toString();
export const scaleLabel = (metres: number, unit: 'm' | 'km' = 'm') =>
  Number((metres / (unit === 'km' ? 1000 : 1)).toPrecision(6)).toString();
