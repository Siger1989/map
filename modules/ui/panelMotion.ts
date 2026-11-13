export type PanelSide = 'top' | 'bottom' | 'left' | 'right' | 'center';

/** Direction follows the panel's resting edge, not the button that opened it. */
export function panelMotion(element: HTMLElement) {
  const kind = element.dataset.panelKind;
  let side = element.dataset.springSide as PanelSide | undefined;
  if (!side && kind) side = ['outdoor', 'tools', 'track'].includes(kind) ? 'bottom' : 'top';
  if (!side) {
    const box = element.getBoundingClientRect();
    const host = element.closest('main')?.getBoundingClientRect() ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
    const x = (box.left + box.width / 2 - host.left) / host.width;
    const y = (box.top + box.height / 2 - host.top) / host.height;
    const edges = [['top', y], ['bottom', 1 - y], ['left', x], ['right', 1 - x]] as [PanelSide, number][];
    edges.sort((a, b) => a[1] - b[1]);
    side = edges[0][1] < .36 ? edges[0][0] : 'center';
  }
  const vectors = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0], center: [0, 0] };
  const [x, y] = vectors[side];
  return {
    side,
    origin: { top: '50% 0%', bottom: '50% 100%', left: '0% 50%', right: '100% 50%', center: '50% 50%' }[side],
    from: `${x * 10}px ${y * 10}px`,
    rebound: `${-x}px ${-y}px`,
    to: `${x * 4}px ${y * 4}px`,
  };
}
