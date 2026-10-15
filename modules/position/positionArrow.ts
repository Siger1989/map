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

/** High-density, north-pointing navigation arrow with a small beveled body. */
export function positionNavigationArrowImage() {
  const scale = 8, logicalWidth = 18, logicalHeight = 22,
    width = logicalWidth * scale, height = logicalHeight * scale,
    data = new Uint8Array(width * height * 4);
  const body: readonly (readonly [number, number])[] = [
    [9, 1.1], [9.5, 2], [17.1, 19.2], [17, 20], [16.1, 20.1],
    [9, 16.4], [1.9, 20.1], [1, 20], [.9, 19.2],
  ];
  const inside = (x: number, y: number, points: readonly (readonly [number, number])[]) => {
    let hit = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[i], [bx, by] = points[j];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) hit = !hit;
    }
    return hit;
  };
  const paint = (points: readonly (readonly [number, number])[], color: readonly [number, number, number], opacity = 1) => {
    const scaled = points.map(([x, y]) => [x * scale, y * scale] as const),
      minX = Math.max(0, Math.floor(Math.min(...scaled.map(([x]) => x)) - 1)),
      maxX = Math.min(width - 1, Math.ceil(Math.max(...scaled.map(([x]) => x)) + 1)),
      minY = Math.max(0, Math.floor(Math.min(...scaled.map(([, y]) => y)) - 1)),
      maxY = Math.min(height - 1, Math.ceil(Math.max(...scaled.map(([, y]) => y)) + 1));
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      if (!inside(x + .5, y + .5, scaled)) continue;
      const index = (y * width + x) * 4, sourceAlpha = opacity,
        destAlpha = data[index + 3] / 255,
        outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
      if (!outAlpha) continue;
      data[index] = Math.round((color[0] * sourceAlpha + data[index] * destAlpha * (1 - sourceAlpha)) / outAlpha);
      data[index + 1] = Math.round((color[1] * sourceAlpha + data[index + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha);
      data[index + 2] = Math.round((color[2] * sourceAlpha + data[index + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha);
      data[index + 3] = Math.round(outAlpha * 255);
    }
  };
  const offset = (points: readonly (readonly [number, number])[], dx: number, dy: number) => points.map(([x, y]) => [x + dx, y + dy] as const);

  paint(offset(body, .7, 1.15), [2, 19, 53], .16);
  paint(offset(body, .35, .65), [2, 19, 53], .22);
  paint(body, [2, 37, 91]);
  const face = [[9, 2.2], [15.9, 18.7], [9, 15.1], [2.1, 18.7]] as const;
  paint(face, [0, 110, 229]);
  paint([[9, 2.2], [9, 15.1], [2.1, 18.7]], [0, 68, 157]);
  paint([[9, 2.2], [15.9, 18.7], [9, 15.1]], [25, 151, 255]);
  paint([[9, 2.5], [9.55, 3.8], [9.25, 14.7], [8.75, 14.7]], [151, 221, 255], .82);
  return { width, height, data, pixelRatio: scale };
}
