import { layoutCss } from './model.mjs';
import { elementScale } from './geometry.mjs';
import {
  referenceFrame,
  anchorPosition,
  findAnchorElement,
} from './anchors.mjs';

/** Resolve anchors against native responsive layout; never change positioning, parents or business state. */
export function renderAnchoredLayout(doc, style, layout, scope = '') {
  const entries = layout.entries.map((e) => ({ ...e }));
  const write = () => {
    const css = layoutCss({ ...layout, entries }, scope);
    if (style.textContent !== css) style.textContent = css;
  };
  write();
  const nodes = entries
    .map((entry) => ({
      entry,
      element: findAnchorElement(doc, entry.selector),
    }))
    .filter((item) => item.element && item.entry.anchor);
  const depth = (node) => {
    let n = 0;
    for (; node; node = node.parentElement) n++;
    return n;
  };
  nodes.sort((a, b) => depth(a.element) - depth(b.element));
  for (const level of new Set(nodes.map((n) => depth(n.element)))) {
    let changed = false;
    for (const { entry, element } of nodes.filter(
      (n) => depth(n.element) === level,
    )) {
      const r = element.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const target = anchorPosition(
        entry.anchor,
        referenceFrame(element, entry.anchor.reference),
        r,
      );
      const parent = elementScale(element).parentScale;
      if (
        Math.abs(target.left - r.left) < 0.01 &&
        Math.abs(target.top - r.top) < 0.01
      )
        continue;
      entry.dx = Math.max(
        -3000,
        Math.min(3000, entry.dx + (target.left - r.left) / parent.x),
      );
      entry.dy = Math.max(
        -3000,
        Math.min(3000, entry.dy + (target.top - r.top) / parent.y),
      );
      changed = true;
    }
    if (changed) write();
  }
  return new Map(entries.map((e) => [e.selector, e]));
}

/** Layout changes and newly opened panels also need anchoring, even while the editor is closed. */
export function observeAnchoredLayout(doc, repaint) {
  const view = doc.defaultView;
  let pending;
  const schedule = () => {
    view.clearTimeout(pending);
    pending = view.setTimeout(repaint, 40);
  };
  view.addEventListener('resize', schedule);
  const mutation =
    view.MutationObserver &&
    new view.MutationObserver((records) => {
      if (
        records.some(
          (record) => !record.target.closest?.('[data-layout-ignore]'),
        )
      )
        schedule();
    });
  mutation?.observe(doc.body, { childList: true, subtree: true });
  const resize = view.ResizeObserver && new view.ResizeObserver(schedule);
  const observed = new WeakSet();
  return {
    watch(elements) {
      for (const element of elements)
        if (element && !observed.has(element)) {
          observed.add(element);
          resize?.observe(element);
          if (element.parentElement) resize?.observe(element.parentElement);
        }
    },
    dispose() {
      view.clearTimeout(pending);
      view.removeEventListener('resize', schedule);
      mutation?.disconnect();
      resize?.disconnect();
    },
  };
}
