import { dragPatch } from './geometry.mjs';
import { alignFrame } from './alignment.mjs';

function displayedFrame(start, patch) {
  const parent = start.parentScale ?? { x: 1, y: 1 };
  const factor = patch.scale == null ? null : patch.scale / start.entry.scale;
  const width = start.rect.width * (factor ?? patch.width / start.box.width);
  const height =
    start.rect.height * (factor ?? patch.height / start.box.height);
  const left = start.rect.left + (patch.dx - start.entry.dx) * parent.x;
  const top = start.rect.top + (patch.dy - start.entry.dy) * parent.y;
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  };
}

/** Pointer resize owns the moving edge. Numeric sizing keeps the saved anchor.
 * Convert to display-space batch geometry so parent scale is applied only once.
 */
export function resizeDrag(start, delta, options = {}) {
  let patch = dragPatch(start, delta, options),
    rect = displayedFrame(start, patch);
  const { peers = [], viewport, threshold = 6, guides = true } = options;
  if (guides && viewport) {
    const aligned = alignFrame(rect, peers, viewport, threshold, start.handle);
    let adjusted = { ...delta };
    if ((options.contentScale || options.ratio) && aligned.lines.length) {
      const axis = aligned.lines
        .map((line) => line.axis)
        .sort(
          (a, b) => Math.abs(aligned.delta[a]) - Math.abs(aligned.delta[b]),
        )[0];
      const horizontal = axis === 'x',
        low = horizontal ? 'w' : 'n';
      const size = horizontal ? 'width' : 'height';
      const factor =
        (rect[size] +
          aligned.delta[axis] * (start.handle.includes(low) ? -1 : 1)) /
        start.rect[size];
      adjusted = {
        x: /[ew]/.test(start.handle)
          ? start.rect.width *
            (factor - 1) *
            (start.handle.includes('w') ? -1 : 1)
          : 0,
        y: /[ns]/.test(start.handle)
          ? start.rect.height *
            (factor - 1) *
            (start.handle.includes('n') ? -1 : 1)
          : 0,
      };
    } else {
      adjusted.x += aligned.delta.x;
      adjusted.y += aligned.delta.y;
    }
    if (aligned.lines.length) {
      patch = dragPatch(start, adjusted, { ...options, snap: false });
      rect = displayedFrame(start, patch);
    }
  }
  return {
    patch: {
      dx: rect.left - start.rect.left,
      dy: rect.top - start.rect.top,
      ...(patch.scale == null
        ? { width: rect.width, height: rect.height }
        : { scale: patch.scale / start.entry.scale }),
    },
    // Only show lines actually reached after size limits and ratio constraints.
    lines:
      guides && viewport
        ? alignFrame(rect, peers, viewport, 0.5, start.handle).lines
        : [],
  };
}
