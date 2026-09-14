import { dragPatch, bounds, scaleLimits } from './geometry.mjs';
import { pick } from './selection.mjs';
import { alignmentTargets, alignFrame, createGuideView } from './alignment.mjs';
import { resizeDrag } from './resize.mjs';

/** Editor gestures never forward inputs to the map while selection mode is active. */
export function bindGestures({
  cover,
  zoom,
  operating,
  document,
  selectedNode,
  targets,
  multiple,
  contains,
  updateBatch,
  entry,
  select,
  granularity,
  checkpoint,
  update,
  syncPanels,
  status,
  snap,
  ratio,
  additive = () => false,
  interaction = () => 'move',
  guides = () => true,
}) {
  const showGuides = createGuideView(cover, zoom);
  let gesture = null,
    pending = null,
    raf = 0;
  const applyPointer = (event) => {
    if (!gesture) return;
    const g = gesture,
      delta = {
        x: (event.clientX - g.x) / zoom(),
        y: (event.clientY - g.y) / zoom(),
      };
    if (!g.started && Math.abs(delta.x) + Math.abs(delta.y) < 3) return;
    if (!g.started) {
      checkpoint();
      g.started = true;
    }
    if (g.handle !== 'move') {
      const resized = resizeDrag(g, delta, {
        snap: snap(),
        contentScale: ratio(),
        guides: guides(),
        peers: g.peers,
        viewport: g.viewport,
        threshold: 6 / zoom(),
      });
      showGuides(resized.lines);
      updateBatch(g.items, g.rect, resized.patch, false, true, 'pointer');
      return;
    }
    const patch = dragPatch(g, delta, { snap: snap(), contentScale: ratio() });
    if (g.handle === 'move' && guides()) {
      const parent = g.parentScale ?? { x: 1, y: 1 };
      const x = (patch.dx - g.entry.dx) * parent.x,
        y = (patch.dy - g.entry.dy) * parent.y;
      const moved = {
        left: g.rect.left + x,
        right: g.rect.right + x,
        top: g.rect.top + y,
        bottom: g.rect.bottom + y,
      };
      const aligned = alignFrame(moved, g.peers, g.viewport, 6 / zoom());
      patch.dx = Math.max(
        -3000,
        Math.min(3000, patch.dx + aligned.delta.x / parent.x),
      );
      patch.dy = Math.max(
        -3000,
        Math.min(3000, patch.dy + aligned.delta.y / parent.y),
      );
      showGuides(aligned.lines);
    }
    if (g.batch) {
      updateBatch(g.items, g.rect, patch, false, true);
      return;
    }
    update(patch, false, true);
  };
  cover.onpointerdown = (event) => {
    if (event.button !== 0 || operating()) return;
    let toggleOnTap = null;
    const handle =
      event.target.closest('[data-resize]')?.dataset.resize ?? 'move';
    if (handle !== 'move' && interaction() !== 'resize') return;
    if (!event.target.closest('[data-resize],#move-selection')) {
      const stage = cover.getBoundingClientRect();
      const target = pick(
        document(),
        (event.clientX - stage.left) / zoom(),
        (event.clientY - stage.top) / zoom(),
        granularity(),
      );
      if (!target) {
        status('请从左侧清单选择被遮挡的控件，或点击界面组件。');
        return;
      }
      if (
        event.shiftKey ||
        event.ctrlKey ||
        event.metaKey ||
        (additive() && !contains(target.selector))
      ) {
        select(target.selector, target.label, true);
        cover.focus({ preventScroll: true });
        event.preventDefault();
        return;
      }
      if (additive()) toggleOnTap = target;
      if (!contains(target.selector)) select(target.selector, target.label);
    }
    if (handle === 'move' && interaction() === 'resize') {
      if (toggleOnTap) select(toggleOnTap.selector, toggleOnTap.label, true);
      event.preventDefault();
      return;
    }
    const items = targets(),
      batch = multiple();
    if (!items.length) return;
    const rect = bounds(items);
    gesture = {
      ...(batch
        ? {
            rect,
            box: { width: rect.width, height: rect.height },
            entry: { dx: 0, dy: 0, scale: 1 },
          }
        : items[0]),
      x: event.clientX,
      y: event.clientY,
      items,
      scaleLimits: batch ? scaleLimits(items) : undefined,
      peers: guides() ? alignmentTargets(document(), items) : [],
      viewport: {
        width: document().defaultView.innerWidth,
        height: document().defaultView.innerHeight,
      },
      batch,
      toggleOnTap,
      handle,
      started: false,
    };
    cover.setPointerCapture(event.pointerId);
    cover.focus({ preventScroll: true });
    event.preventDefault();
  };
  cover.onpointermove = (event) => {
    if (!gesture) return;
    pending = { clientX: event.clientX, clientY: event.clientY };
    if (!raf)
      raf = requestAnimationFrame(() => {
        raf = 0;
        applyPointer(pending);
      });
  };
  const end = (event) => {
    if (!gesture) return;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (event.type === 'pointerup') applyPointer(event);
    const tap =
      event.type === 'pointerup' && !gesture.started && gesture.toggleOnTap;
    gesture = null;
    pending = null;
    showGuides();
    syncPanels();
    if (tap) select(tap.selector, tap.label, true);
  };
  cover.onpointerup = end;
  cover.onpointercancel = end;
  cover.onlostpointercapture = end;
  cover.onkeydown = (event) => {
    if (
      operating() ||
      interaction() !== 'move' ||
      !selectedNode() ||
      !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
    )
      return;
    event.preventDefault();
    const step = event.shiftKey ? 10 : 1;
    update(
      dragPatch(
        { entry: multiple() ? { dx: 0, dy: 0 } : entry() },
        {
          x:
            event.key === 'ArrowRight'
              ? step
              : event.key === 'ArrowLeft'
                ? -step
                : 0,
          y:
            event.key === 'ArrowDown'
              ? step
              : event.key === 'ArrowUp'
                ? -step
                : 0,
        },
      ),
    );
  };
  return () => !!gesture;
}
