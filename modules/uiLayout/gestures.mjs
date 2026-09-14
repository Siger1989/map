import { dragPatch, bounds } from './geometry.mjs';
import { pick } from './selection.mjs';

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
}) {
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
    const patch = dragPatch(g, delta, { snap: snap(), ratio: ratio() });
    if (g.batch) {
      updateBatch(g.items, g.rect, patch, false, true);
      return;
    }
    update(patch, false, true);
    if (g.handle !== 'move') {
      // Preserve the opposite edge even for right/bottom-anchored or flex-positioned widgets.
      const actual = selectedNode()?.getBoundingClientRect();
      if (actual)
        update(
          {
            ...patch,
            dx: Math.max(
              -3000,
              Math.min(
                3000,
                patch.dx +
                  (g.handle.includes('w')
                    ? g.rect.right - actual.right
                    : g.rect.left - actual.left) /
                    g.parentScale.x,
              ),
            ),
            dy: Math.max(
              -3000,
              Math.min(
                3000,
                patch.dy +
                  (g.handle.includes('n')
                    ? g.rect.bottom - actual.bottom
                    : g.rect.top - actual.top) /
                    g.parentScale.y,
              ),
            ),
          },
          false,
          true,
        );
    }
  };
  cover.onpointerdown = (event) => {
    if (event.button !== 0 || operating()) return;
    let toggleOnTap = null;
    const handle =
      event.target.closest('[data-resize]')?.dataset.resize ?? 'move';
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
    syncPanels();
    if (tap) select(tap.selector, tap.label, true);
  };
  cover.onpointerup = end;
  cover.onpointercancel = end;
  cover.onlostpointercapture = end;
  cover.onkeydown = (event) => {
    if (
      operating() ||
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
