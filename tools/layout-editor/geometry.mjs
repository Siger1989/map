const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const round = (n, snap) => (snap ? Math.round(n / 4) * 4 : Math.round(n));

/** Pointer deltas are in unzoomed preview pixels; ancestor scaling changes local CSS pixels. */
export function dragPatch(start, delta, { snap = false, ratio = false } = {}) {
  const {
    entry,
    box,
    parentScale = { x: 1, y: 1 },
    ownScale = { x: entry.scale, y: entry.scale },
    handle = 'move',
  } = start;
  const dx = delta.x / parentScale.x,
    dy = delta.y / parentScale.y;
  if (handle === 'move')
    return {
      dx: clamp(round(entry.dx + dx, snap), -3000, 3000),
      dy: clamp(round(entry.dy + dy, snap), -3000, 3000),
    };
  let width = box.width,
    height = box.height;
  if (handle.includes('e')) width += dx / ownScale.x;
  if (handle.includes('w')) width -= dx / ownScale.x;
  if (handle.includes('s')) height += dy / ownScale.y;
  if (handle.includes('n')) height -= dy / ownScale.y;
  if (ratio && handle.length === 2) {
    const horizontal = width / box.width,
      vertical = height / box.height;
    const factor =
      Math.abs(horizontal - 1) >= Math.abs(vertical - 1)
        ? horizontal
        : vertical;
    width = box.width * factor;
    height = box.height * factor;
  }
  width = clamp(round(width, snap), 16, 2000);
  height = clamp(round(height, snap), 16, 2000);
  return {
    width,
    height,
    dx: clamp(
      entry.dx + (handle.includes('w') ? (box.width - width) * ownScale.x : 0),
      -3000,
      3000,
    ),
    dy: clamp(
      entry.dy +
        (handle.includes('n') ? (box.height - height) * ownScale.y : 0),
      -3000,
      3000,
    ),
  };
}

export function alignPatch(
  entry,
  rect,
  viewport,
  action,
  parentScale = { x: 1, y: 1 },
) {
  const target = {
    left: { x: 4 },
    right: { x: viewport.width - rect.width - 4 },
    center: { x: (viewport.width - rect.width) / 2 },
    top: { y: 4 },
    bottom: { y: viewport.height - rect.height - 4 },
    recover: {
      x: Math.max(4, (viewport.width - rect.width) / 2),
      y: Math.max(4, (viewport.height - rect.height) / 2),
    },
  }[action];
  if (!target) throw Error('未知对齐方式');
  return {
    dx: clamp(
      entry.dx +
        (target.x === undefined ? 0 : (target.x - rect.left) / parentScale.x),
      -3000,
      3000,
    ),
    dy: clamp(
      entry.dy +
        (target.y === undefined ? 0 : (target.y - rect.top) / parentScale.y),
      -3000,
      3000,
    ),
  };
}

/** Only inspect this preview's UI ancestors. Existing CSS transforms stay intact. */
export function elementScale(node) {
  const view = node.ownerDocument.defaultView;
  const scaleOf = (element) => {
    const style = view.getComputedStyle(element),
      values = style.scale.split(/\s+/).map(Number);
    const individual = { x: values[0] || 1, y: values[1] || values[0] || 1 };
    const matrix =
      style.transform === 'none'
        ? null
        : new view.DOMMatrixReadOnly(style.transform);
    const zoom = parseFloat(style.zoom) || 1;
    return {
      x:
        Math.abs(individual.x) *
        (matrix ? Math.hypot(matrix.a, matrix.b) : 1) *
        zoom,
      y:
        Math.abs(individual.y) *
        (matrix ? Math.hypot(matrix.c, matrix.d) : 1) *
        zoom,
    };
  };
  const parentScale = { x: 1, y: 1 };
  for (let parent = node.parentElement; parent; parent = parent.parentElement) {
    const scale = scaleOf(parent);
    parentScale.x *= scale.x;
    parentScale.y *= scale.y;
  }
  return { parentScale, ownScale: scaleOf(node) };
}
