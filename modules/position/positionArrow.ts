/** A north-pointing marker; MapLibre rotates it in map coordinates. */
export function positionArrowImage(color: readonly [number, number, number] = [203, 210, 207]) {
  const width = 36, height = 44, data = new Uint8Array(width * height * 4);
  const outer = [[18, 2], [34, 40], [18, 32], [2, 40]];
  const inner = [[18, 8], [29, 34], [18, 28], [7, 34]];
  const inside = (x: number, y: number, points: number[][]) => {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [a, b] = points[i], [c, d] = points[j];
      if ((b > y) !== (d > y) && x < (c - a) * (y - b) / (d - b) + a) hit = !hit;
    }
    return hit;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!inside(x + .5, y + .5, outer)) continue;
    data.set(inside(x + .5, y + .5, inner) ? [...color, 255] : [255, 255, 255, 255], (y * width + x) * 4);
  }
  return { width, height, data };
}
