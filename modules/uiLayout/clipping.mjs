import { layoutSelector } from './model.mjs';
import { selectorFor } from './selection.mjs';
import { findAnchorElement } from './anchors.mjs';

const boundaries =
  'html,body,main,#root,#__next,.observatory,.maplibregl-map,[data-layout-ignore]';
// This HUD stacks independent cards. Its default overflow limits map coverage;
// once a card is placed separately it must be allowed outside the stack.
const independentStacks = '.route-display-info';
const geometricallyEdited = (e) =>
  !e.hidden &&
  (e.dx || e.dy || e.scale !== 1 || e.width != null || e.height != null);

/** Release decorative clipping only on ancestors of independently placed UI.
 * Native scrolling lists remain scrollable; their content is not detached.
 * Called against the base layout CSS, before these derived overrides apply.
 */
export function layoutOverflowCss(doc, entries, scope = '') {
  const parents = new Set();
  for (const entry of entries.filter(geometricallyEdited)) {
    const element = findAnchorElement(doc, entry.selector);
    if (!element || (scope && !element.closest(scope))) continue;
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      if (parent.matches(boundaries)) break;
      const style = doc.defaultView.getComputedStyle(parent);
      const axes = [
        style.overflowX || style.overflow,
        style.overflowY || style.overflow,
      ];
      if (
        parent.matches(independentStacks) ||
        (axes.some((axis) => /^(hidden|clip)$/.test(axis)) &&
          !axes.some((axis) => /^(auto|scroll|overlay)$/.test(axis)))
      )
        parents.add(parent);
    }
  }
  return [...parents]
    .map(
      (parent) =>
        `${layoutSelector(selectorFor(parent, doc), scope)}{overflow:visible!important;}`,
    )
    .join('\n');
}
