import { emptyLayout, validateLayout, layoutCss } from './model.mjs';
import { defaults, visible, selectionRoots } from './selection.mjs';
import { capture, bounds, batchPatches, fontSizePatches } from './geometry.mjs';
import { layerPatches } from './layers.mjs';

export const STORAGE_KEY = 'shantu.ui-layout.v1';

/** Local-only editor state. No map objects or route data enter this interface. */
export function createSession(doc, storage) {
  let layout = emptyLayout(),
    saved,
    selected = [],
    message = '',
    listener = () => {};
  const past = [],
    future = [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) layout = validateLayout(JSON.parse(raw));
  } catch {
    message = '旧布局无法读取，已使用默认界面；原文件未覆盖。';
  }
  saved = JSON.stringify(layout);
  const style = doc.createElement('style');
  style.dataset.layoutIgnore = '';
  doc.head.append(style);
  const find = (selector) => {
    try {
      return doc.querySelector(selector);
    } catch {
      return null;
    }
  };
  const entry = (s) =>
    layout.entries.find((e) => e.selector === s.selector) ??
    defaults(s.selector, s.label);
  const notify = () => listener();
  const apply = () => {
    // Scope all imported selectors to map UI; the recovery button and editor cannot be hidden.
    style.textContent = layoutCss(layout, '.observatory');
  };
  const checkpoint = () => {
    past.push(JSON.stringify(layout));
    if (past.length > 50) past.shift();
    future.length = 0;
  };
  const replace = (entries) => {
    const updates = new Map(entries.map((e) => [e.selector, e]));
    layout = validateLayout({
      ...layout,
      entries: [
        ...layout.entries.filter((e) => !updates.has(e.selector)),
        ...updates.values(),
      ],
    });
    apply();
  };
  const targets = () =>
    selectionRoots(
      selected
        .map((s) => ({ ...s, element: find(s.selector) }))
        .filter((s) => s.element && visible(s.element)),
    ).map((s) => capture(s.element, entry(s)));
  const change = (operation, remember = true, light = false) => {
    const before = JSON.stringify(layout);
    if (remember) checkpoint();
    try {
      operation();
      message = '尚未保存';
    } catch (error) {
      layout = JSON.parse(before);
      if (remember) past.pop();
      apply();
      message = error.message;
    }
    if (!light) notify();
  };
  const updateBatch = (items, box, patch, remember = true, light = false) =>
    change(
      () => {
        const changes = batchPatches(items, box, patch);
        replace(changes.map((c) => c.next));
        if (['width', 'height', 'scale'].some((key) => patch[key] != null)) {
          replace(
            changes.map(({ element, next, target, parentScale }) => {
              const actual = element.getBoundingClientRect();
              return {
                ...next,
                dx: Math.max(
                  -3000,
                  Math.min(
                    3000,
                    next.dx + (target.left - actual.left) / parentScale.x,
                  ),
                ),
                dy: Math.max(
                  -3000,
                  Math.min(
                    3000,
                    next.dy + (target.top - actual.top) / parentScale.y,
                  ),
                ),
              };
            }),
          );
        }
      },
      remember,
      light,
    );
  apply();
  return {
    doc,
    find,
    entry,
    targets,
    checkpoint,
    updateBatch,
    get layout() {
      return layout;
    },
    get selected() {
      return selected;
    },
    get message() {
      return message;
    },
    get dirty() {
      return JSON.stringify(layout) !== saved;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    subscribe(fn) {
      listener = fn;
    },
    status(text) {
      message = text;
      notify();
    },
    select(selector, label, toggle = false) {
      selected = toggle
        ? selected.some((s) => s.selector === selector)
          ? selected.filter((s) => s.selector !== selector)
          : [...selected, { selector, label }]
        : [{ selector, label }];
      notify();
    },
    clearSelection() {
      selected = [];
      notify();
    },
    update(patch, remember = true, light = false) {
      if (!selected.length) return;
      if (selected.length > 1) {
        const items = targets(),
          box = bounds(items);
        if (box) updateBatch(items, box, patch, remember, light);
      } else
        change(
          () => replace([{ ...entry(selected[0]), ...patch }]),
          remember,
          light,
        );
    },
    setFontSize(pixels) {
      change(() => replace(fontSizePatches(targets(), pixels)));
    },
    stepLayer(direction) {
      change(() => replace(layerPatches(targets(), direction)));
    },
    history(redo = false) {
      const from = redo ? future : past,
        to = redo ? past : future;
      if (!from.length) return;
      to.push(JSON.stringify(layout));
      layout = JSON.parse(from.pop());
      apply();
      notify();
    },
    save() {
      try {
        const viewport = {
          width: Math.max(266, Math.min(1600, doc.defaultView.innerWidth)),
          height: Math.max(400, Math.min(1600, doc.defaultView.innerHeight)),
        };
        const next = validateLayout({ ...layout, viewport });
        storage.setItem(STORAGE_KEY, JSON.stringify(next));
        layout = next;
        saved = JSON.stringify(layout);
        message = '已保存，重启后继续使用';
        notify();
        return true;
      } catch {
        message = '保存失败，请导出备份后重试';
        notify();
        return false;
      }
    },
    restore(all = false) {
      change(() => {
        layout = {
          ...layout,
          entries: all
            ? []
            : layout.entries.filter(
                (e) => !selected.some((s) => s.selector === e.selector),
              ),
        };
        apply();
      });
    },
    import(raw) {
      const next = validateLayout(JSON.parse(raw));
      change(() => {
        layout = next;
        selected = [];
        apply();
      });
    },
    cancel() {
      layout = JSON.parse(saved);
      selected = [];
      past.length = future.length = 0;
      apply();
      notify();
    },
    dispose() {
      style.remove();
      listener = () => {};
    },
  };
}
