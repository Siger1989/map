// Pure geometry shared by desktop and touch editing.
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const round = (n, snap) => (snap ? Math.round(n / 4) * 4 : Math.round(n));

/** Pointer deltas are in unzoomed preview pixels; ancestor scaling changes local CSS pixels. */
export function dragPatch(
  start,
  delta,
  { snap = false, ratio = false, contentScale = false } = {},
) {
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
  if ((ratio || contentScale) && handle.length === 2) {
    const horizontal = width / box.width,
      vertical = height / box.height;
    const factor =
      Math.abs(horizontal - 1) >= Math.abs(vertical - 1)
        ? horizontal
        : vertical;
    width = box.width * factor;
    height = box.height * factor;
  }
  if (contentScale) {
    const horizontal = /[ew]/.test(handle);
    const size = horizontal ? box.width : box.height;
    const nextSize = horizontal ? width : height;
    const limits = start.scaleLimits ?? {
      min: 0.4 / entry.scale,
      max: 2.5 / entry.scale,
    };
    const factor = clamp(
      (snap ? round(nextSize, true) : nextSize) / size,
      limits.min,
      limits.max,
    );
    return {
      scale: entry.scale * factor,
      dx: clamp(
        entry.dx +
          (handle.includes('w') ? box.width * ownScale.x * (1 - factor) : 0),
        -3000,
        3000,
      ),
      dy: clamp(
        entry.dy +
          (handle.includes('n') ? box.height * ownScale.y * (1 - factor) : 0),
        -3000,
        3000,
      ),
    };
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

export function bounds(items) {
  if (!items.length) return null;
  const left = Math.min(...items.map(({ rect }) => rect.left));
  const top = Math.min(...items.map(({ rect }) => rect.top));
  const right = Math.max(...items.map(({ rect }) => rect.right));
  const bottom = Math.max(...items.map(({ rect }) => rect.bottom));
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}

export function capture(element, entry) {
  const rect = element.getBoundingClientRect(),
    scales = elementScale(element);
  return {
    element,
    entry: { ...entry },
    rect,
    ...scales,
    box: {
      width:
        element.offsetWidth ||
        rect.width / (scales.parentScale.x * scales.ownScale.x),
      height:
        element.offsetHeight ||
        rect.height / (scales.parentScale.y * scales.ownScale.y),
    },
  };
}

/** Keep a multi-selection at one common ratio when any member reaches its limit. */
export function scaleLimits(items) {
  return {
    min: Math.max(...items.map(({ entry }) => 0.4 / entry.scale)),
    max: Math.min(...items.map(({ entry }) => 2.5 / entry.scale)),
  };
}

export function dimensionScalePatch(items, dimension, value) {
  const frame = bounds(items);
  if (
    !frame ||
    !['width', 'height'].includes(dimension) ||
    !Number.isFinite(value) ||
    value <= 0
  )
    throw Error('请先选择组件并输入有效尺寸');
  const limits = scaleLimits(items);
  return { scale: clamp(value / frame[dimension], limits.min, limits.max) };
}

function fontReference(item) {
  const element = item.element;
  const nodes = [
    element,
    ...(element?.querySelectorAll?.(
      'small,span,label,strong,p,input,button,select,text',
    ) ?? []),
  ];
  const node =
    nodes.find(
      (candidate) =>
        candidate?.getBoundingClientRect?.().width > 0 &&
        (candidate.matches?.('input,select,textarea') ||
          [...(candidate.childNodes ?? [])].some(
            (child) => child.nodeType === 3 && child.textContent.trim(),
          )),
    ) ?? element;
  const scales = node === element ? item : elementScale(node);
  return { node, factor: scales.parentScale.y * scales.ownScale.y };
}

export function fontMetrics(items) {
  const item = items.at(-1);
  if (!item) return null;
  const { node, factor } = fontReference(item);
  const base =
    parseFloat(
      node.ownerDocument.defaultView.getComputedStyle(node).fontSize,
    ) || 16;
  return { pixels: Math.round(base * factor * 10) / 10 };
}

/** The field shows displayed pixels; persisted fontSize stays in the element's local CSS units. */
export function fontSizePatches(items, pixels) {
  return items.map((item) => {
    const fontSize =
      pixels === null ? null : pixels / fontReference(item).factor;
    if (
      fontSize !== null &&
      (!Number.isFinite(fontSize) || fontSize < 8 || fontSize > 40)
    )
      throw Error('字号超出当前比例可调范围，请先调整整体比例');
    return { ...item.entry, fontSize };
  });
}

/** Resize a temporary multi-selection; persist independent entries, never reparent the app DOM. */
export function batchPatches(items, frame, patch) {
  const limits = scaleLimits(items);
  const factor =
    patch.scale == null ? 1 : clamp(patch.scale, limits.min, limits.max);
  const sx = patch.width == null ? factor : patch.width / frame.width;
  const sy = patch.height == null ? factor : patch.height / frame.height;
  return items.map((item) => {
    const { entry, rect, box, parentScale } = item;
    const x = (patch.dx ?? 0) + (rect.left - frame.left) * (sx - 1);
    const y = (patch.dy ?? 0) + (rect.top - frame.top) * (sy - 1);
    const next = {
      ...entry,
      dx: clamp(entry.dx + x / parentScale.x, -3000, 3000),
      dy: clamp(entry.dy + y / parentScale.y, -3000, 3000),
    };
    if (patch.width != null || patch.height != null) {
      next.width = clamp(box.width * sx, 16, 2000);
      next.height = clamp(box.height * sy, 16, 2000);
    }
    if (patch.scale != null) next.scale = clamp(entry.scale * factor, 0.4, 2.5);
    for (const key of ['fontSize', 'zIndex', 'hidden'])
      if (key in patch) next[key] = patch[key];
    return {
      ...item,
      next,
      target: { left: rect.left + x, top: rect.top + y },
    };
  });
}
