import { selectable, selectionRoots } from './selection.mjs';

/** Snapshot visible peer frames once per drag, never the map or the editor itself. */
export function alignmentTargets(doc, selected) {
  const peers = selectable(doc, 'component').filter(
    ({ element }) =>
      !selected.some(
        (item) =>
          item.element.contains(element) || element.contains(item.element),
      ),
  );
  return selectionRoots(peers)
    .map(({ element }) => element.getBoundingClientRect())
    .filter(
      (r) =>
        r.right > 0 &&
        r.bottom > 0 &&
        r.left < doc.defaultView.innerWidth &&
        r.top < doc.defaultView.innerHeight,
    );
}

/** Edges and centres use display pixels; the caller handles ancestor/preview scale. */
export function alignFrame(
  rect,
  peers,
  viewport,
  threshold = 6,
  handle = 'move',
) {
  const screen = {
    left: 4,
    top: 4,
    right: viewport.width - 4,
    bottom: viewport.height - 4,
  };
  const delta = { x: 0, y: 0 },
    lines = [];
  for (const [axis, lo, hi, otherLo, otherHi, extent] of [
    ['x', 'left', 'right', 'top', 'bottom', viewport.height],
    ['y', 'top', 'bottom', 'left', 'right', viewport.width],
  ]) {
    let best = null;
    const movingEdges =
      handle === 'move'
        ? [rect[lo], (rect[lo] + rect[hi]) / 2, rect[hi]]
        : handle.includes(axis === 'x' ? 'w' : 'n')
          ? [rect[lo]]
          : handle.includes(axis === 'x' ? 'e' : 's')
            ? [rect[hi]]
            : [];
    for (const target of [...peers, screen])
      for (const anchor of [
        target[lo],
        (target[lo] + target[hi]) / 2,
        target[hi],
      ])
        for (const moving of movingEdges) {
          const distance = anchor - moving;
          if (
            Math.abs(distance) <= threshold &&
            (!best || Math.abs(distance) < Math.abs(best.distance))
          )
            best = { distance, anchor, target };
        }
    if (best) {
      delta[axis] = best.distance;
      lines.push({
        axis,
        position: best.anchor,
        start: Math.max(0, Math.min(rect[otherLo], best.target[otherLo]) - 8),
        end: Math.min(
          extent,
          Math.max(rect[otherHi], best.target[otherHi]) + 8,
        ),
      });
    }
  }
  return { delta, lines };
}

export function createGuideView(cover, zoom) {
  const doc = cover.ownerDocument,
    root = doc.createElement('div');
  root.className = 'layout-alignment-guides';
  root.setAttribute('aria-hidden', 'true');
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    pointerEvents: 'none',
  });
  cover.append(root);
  return (lines = []) =>
    root.replaceChildren(
      ...lines.map((line) => {
        const el = doc.createElement('div'),
          vertical = line.axis === 'x';
        Object.assign(el.style, {
          position: 'absolute',
          background: '#ec4b8a',
          left: `${vertical ? line.position : line.start}px`,
          top: `${vertical ? line.start : line.position}px`,
          width: `${vertical ? 1 / zoom() : line.end - line.start}px`,
          height: `${vertical ? line.end - line.start : 1 / zoom()}px`,
        });
        return el;
      }),
    );
}
