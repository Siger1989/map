import { visible } from './selection.mjs';

const level = (element) =>
  Number.parseInt(
    element.ownerDocument.defaultView.getComputedStyle(element).zIndex,
    10,
  ) || 0;

/** Step past the nearest peer in the same parent. Never reparent application elements. */
export function layerPatches(items, direction) {
  if (direction !== 1 && direction !== -1) throw Error('未知层级方向');
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
