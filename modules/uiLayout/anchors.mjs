import { elementScale } from './geometry.mjs';
import { selectorFor, componentWrappers } from './selection.mjs';

const structural = 'html,body,main.observatory,#root,#__next';
const safeProbes = new WeakMap();
export function viewportFrame(doc) {
  let probe = safeProbes.get(doc);
  if (!probe?.isConnected) {
    probe = doc.createElement('div');
    probe.dataset.layoutIgnore = '';
    probe.dataset.layoutSafe = '';
    probe.style.cssText =
      'position:fixed;visibility:hidden;pointer-events:none;width:0;height:0;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    doc.body.append(probe);
    safeProbes.set(doc, probe);
  }
  const view = doc.defaultView,
    style = view.getComputedStyle(probe);
  const top = parseFloat(style.paddingTop) || 0,
    bottom = parseFloat(style.paddingBottom) || 0,
    left = parseFloat(style.paddingLeft) || 0,
    right = parseFloat(style.paddingRight) || 0;
  return {
    rect: rect(
      left,
      top,
      view.innerWidth - left - right,
      view.innerHeight - top - bottom,
    ),
    reference: 'viewport',
    scale: { x: 1, y: 1 },
  };
}
const rect = (left, top, width, height) => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});
export function findAnchorElement(doc, selector) {
  try {
    return doc.querySelector(selector);
  } catch {
    return null;
  }
}
export function referenceFrame(element, reference) {
  const doc = element.ownerDocument,
    view = doc.defaultView;
  let parent;
  if (reference && reference !== 'viewport') {
    try {
      parent = doc.querySelector(reference);
    } catch {
      /* A removed container falls back to the viewport. */
    }
  } else if (!reference) {
    const style = view.getComputedStyle(element);
    if (style.position === 'fixed') {
      for (
        let node = element.parentElement;
        node && !node.matches(structural);
        node = node.parentElement
      ) {
        const p = view.getComputedStyle(node);
        if (
          ['transform', 'scale', 'translate', 'perspective'].some(
            (key) => p[key] && p[key] !== 'none',
          )
        ) {
          parent = node;
          break;
        }
      }
    } else
      parent =
        style.position === 'absolute'
          ? element.offsetParent
          : element.parentElement;
  }
  const parentStyle = parent && view.getComputedStyle(parent);
  const transparent =
    parent?.matches(`${componentWrappers},.map-toolbar`) &&
    !['transform', 'scale', 'translate'].some(
      (key) => parentStyle[key] && parentStyle[key] !== 'none',
    );
  if (
    parent &&
    parent !== element &&
    !parent.matches(structural) &&
    !transparent
  ) {
    const r = parent.getBoundingClientRect();
    if (r.width && r.height) {
      const scales = elementScale(parent);
      return {
        rect: r,
        reference: selectorFor(parent, doc),
        scale: {
          x: scales.parentScale.x * scales.ownScale.x,
          y: scales.parentScale.y * scales.ownScale.y,
        },
      };
    }
  }
  return viewportFrame(doc);
}

export function captureAnchor(
  element,
  box = element.getBoundingClientRect(),
  frame = referenceFrame(element),
) {
  const axis = (lo, hi, mid, unit) => {
    const start = (box[lo] - frame.rect[lo]) / unit,
      end = (frame.rect[hi] - box[hi]) / unit;
    const centre =
      (box[lo] + box[hi] - (frame.rect[lo] + frame.rect[hi])) / (2 * unit);
    return Math.abs(centre) <= 12
      ? [mid, centre]
      : Math.abs(start) <= Math.abs(end)
        ? [lo, start]
        : [hi, end];
  };
  const [x, gapX] = axis('left', 'right', 'center', frame.scale.x),
    [y, gapY] = axis('top', 'bottom', 'center', frame.scale.y);
  return { reference: frame.reference, x, y, gapX, gapY };
}

/** Editing a whole parent makes previously independent child anchors follow that parent. */
export function rebaseChildAnchors(doc, entries, items) {
  return entries.flatMap((entry) => {
    if (!entry.anchor) return [];
    const child = findAnchorElement(doc, entry.selector);
    if (!child) return [];
    const parent = items.find(
      (item) => item.element !== child && item.element.contains(child),
    );
    if (!child || !parent) return [];
    const reference =
      entry.anchor.reference === 'viewport'
        ? null
        : findAnchorElement(doc, entry.anchor.reference);
    if (reference && parent.element.contains(reference)) return [];
    const p = parent.element,
      scales = elementScale(p);
    const frame = {
      rect: p.getBoundingClientRect(),
      reference: selectorFor(p, doc),
      scale: {
        x: scales.parentScale.x * scales.ownScale.x,
        y: scales.parentScale.y * scales.ownScale.y,
      },
    };
    return [
      {
        ...entry,
        anchor: captureAnchor(child, child.getBoundingClientRect(), frame),
      },
    ];
  });
}

/** Temporary multi-selection scales around its common edge/centre; spacing scales once. */
export function anchorBatchTargets(items, box, patch, changes) {
  if (
    items.length < 2 ||
    !['width', 'height', 'scale'].some((key) => patch[key] != null)
  )
    return;
  const frame = viewportFrame(items[0].element.ownerDocument);
  const anchor = captureAnchor(items[0].element, box, frame);
  const factor =
    patch.scale == null ? 1 : changes[0].next.scale / items[0].entry.scale;
  const target = anchorPosition(anchor, frame, {
    width: patch.width ?? box.width * factor,
    height: patch.height ?? box.height * factor,
  });
  for (const change of changes) {
    change.target.left += target.left - box.left - (patch.dx ?? 0);
    change.target.top += target.top - box.top - (patch.dy ?? 0);
  }
}

export function anchorPosition(anchor, frame, size) {
  const r = frame.rect,
    x = anchor.gapX * frame.scale.x,
    y = anchor.gapY * frame.scale.y;
  return {
    left:
      anchor.x === 'right'
        ? r.right - size.width - x
        : anchor.x === 'center'
          ? (r.left + r.right - size.width) / 2 + x
          : r.left + x,
    top:
      anchor.y === 'bottom'
        ? r.bottom - size.height - y
        : anchor.y === 'center'
          ? (r.top + r.bottom - size.height) / 2 + y
          : r.top + y,
  };
}

export function anchorLabel(item) {
  if (!item) return '';
  const a = item.entry.anchor ?? captureAnchor(item.element),
    names = { left: '左', right: '右', top: '上', bottom: '下', center: '中' };
  return `${a.reference === 'viewport' ? '屏幕' : '父组'} ${names[a.x]}/${names[a.y]} · ${Math.round(a.gapX)}/${Math.round(a.gapY)}px`;
}

/** Entry translation may change with the viewport; the saved edge distances remain stable. */
export function anchoredEntries(doc, entries, effective = new Map()) {
  return entries.map((entry) => {
    const element = findAnchorElement(doc, entry.selector);
    return element?.getBoundingClientRect().width > 0
      ? {
          ...(effective.get(entry.selector) ?? entry),
          anchor: entry.anchor ?? captureAnchor(element),
        }
      : entry;
  });
}
