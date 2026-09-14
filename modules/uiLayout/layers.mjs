import {
  visible,
  defaults,
  describe,
  selectorFor,
  selectionRoots,
} from './selection.mjs';
import { layoutSelector } from './model.mjs';

const level = (element) =>
  Number.parseInt(
    element.ownerDocument.defaultView.getComputedStyle(element).zIndex,
    10,
  ) || 0;

/** Step past the nearest peer in the same parent. Never reparent application elements. */
const boundary =
  'html,body,main,.observatory,#root,#__next,[data-layout-ignore]';
function stacked(element) {
  const s = element.ownerDocument.defaultView.getComputedStyle(element);
  return (
    ['fixed', 'sticky'].includes(s.position) ||
    (s.zIndex &&
      s.zIndex !== 'auto' &&
      ((s.position && s.position !== 'static') ||
        /flex|grid/.test(
          element.ownerDocument.defaultView.getComputedStyle(
            element.parentElement,
          ).display,
        ))) ||
    [
      'transform',
      'translate',
      'scale',
      'rotate',
      'filter',
      'backdropFilter',
    ].some((key) => s[key] && s[key] !== 'none') ||
    Number(s.opacity) < 1 ||
    s.isolation === 'isolate' ||
    /paint|layout|strict|content/.test(s.contain || '')
  );
}

/** Page scope changes the owning stacking group; group scope changes only the selection. */
export function layerTargets(items, scope = 'group', entries = []) {
  const targets = items.map((item) => {
    let element = item.element;
    if (scope === 'page')
      for (
        let parent = element.parentElement;
        parent && !parent.matches(boundary);
        parent = parent.parentElement
      )
        if (stacked(parent)) element = parent;
    if (element === item.element) return item;
    const selector = selectorFor(element, element.ownerDocument);
    return {
      element,
      entry:
        entries.find((e) => e.selector === selector) ??
        defaults(selector, describe(element)),
    };
  });
  return selectionRoots(
    targets.filter(
      (item, index) =>
        targets.findIndex((other) => other.element === item.element) === index,
    ),
  );
}

export function layerPatches(items, direction, scope = 'group', entries = []) {
  if (direction !== 1 && direction !== -1) throw Error('未知层级方向');
  items = layerTargets(items, scope, entries);
  const selected = new Set(items.map((item) => item.element));
  return items.map(({ element, entry }) => {
    const current = entry.zIndex ?? level(element);
    const peers = [...(element.parentElement?.children ?? [])]
      .filter(
        (peer) =>
          !selected.has(peer) &&
          !peer.closest('[data-layout-ignore]') &&
          visible(peer),
      )
      .map(level)
      .filter((z) => (direction > 0 ? z >= current : z <= current));
    const next = peers.length
      ? direction > 0
        ? Math.min(...peers)
        : Math.max(...peers)
      : current;
    return {
      ...entry,
      zIndex: Math.max(-1000, Math.min(99999, next + direction)),
    };
  });
}

/** z-index on a static block has no effect. Flex/grid items already participate. */
export function layerPositionCss(doc, entries, scope = '') {
  return entries
    .filter((e) => e.zIndex != null)
    .flatMap((entry) => {
      let el;
      try {
        el = doc.querySelector(entry.selector);
      } catch {
        return [];
      }
      if (!el || el.matches(boundary) || (scope && !el.closest(scope)))
        return [];
      const s = doc.defaultView.getComputedStyle(el),
        parent = el.parentElement;
      return s.position === 'static' &&
        parent &&
        !/flex|grid/.test(doc.defaultView.getComputedStyle(parent).display)
        ? [
            `${layoutSelector(entry.selector, scope)}{position:relative!important;}`,
          ]
        : [];
    })
    .join('\n');
}
