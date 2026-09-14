export type PhotoTile = {
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
/** Keep complete images visible, pair mixed orientations, and reserve a full row for the hero. */
export function photoLayout(ratios: number[], hero = -1) {
  const tiles: PhotoTile[] = [],
    order = ratios.map((_, i) => i);
  if (hero >= 0 && hero < order.length)
    (order.splice(order.indexOf(hero), 1), order.unshift(hero));
  let y = 80;
  for (let i = 0; i < order.length;) {
    const a = order[i],
      pair = a !== hero && i + 1 < order.length;
    const ratio = (index: number) =>
      Math.max(0.2, Math.min(5, ratios[index] || 1));
    const height = Math.min(
      a === hero ? 1000 : 620,
      (pair ? 1094 : 1110) / (ratio(a) + (pair ? ratio(order[i + 1]) : 0)),
    );
    const w = pair
      ? (1094 * ratio(a)) / (ratio(a) + ratio(order[i + 1]))
      : 1110;
    tiles.push({ index: a, x: 45, y, width: w, height });
    if (pair)
      tiles.push({
        index: order[i + 1],
        x: 61 + w,
        y,
        width: 1094 - w,
        height,
      });
    y += height + 64;
    i += pair ? 2 : 1;
  }
  return { tiles, height: y + 20 };
}
