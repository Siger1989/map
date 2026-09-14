import { hierarchy } from './selection.mjs';
import {
  bounds,
  alignPatch,
  dimensionScalePatch,
  fontMetrics,
} from './geometry.mjs';
import { bindGestures } from './gestures.mjs';
import { anchorLabel } from './anchors.mjs';

/** Compact touch view. All state, persistence and geometry are supplied by the session. */
export function mountEditor(session, onClose) {
  const doc = session.doc,
    view = doc.defaultView;
  let operating = false,
    additive = false,
    closed = false,
    expanded = false;
  let timer;
  const root = doc.createElement('div');
  root.className = 'layout-mobile';
  root.dataset.layoutIgnore = '';
  root.innerHTML = `
    <div class="layout-mobile-cover" tabindex="0" aria-label="选择并拖动界面组件">
      <div class="layout-mobile-members" hidden></div><div class="layout-mobile-outline" hidden></div>
    </div>
    <section class="layout-mobile-toolbar" aria-label="布局调节工具">
      <div class="layout-mobile-row">
        <button class="layout-mobile-grip" aria-label="拖动布局工具条">⠿</button>
        <select data-mode aria-label="布局操作模式"><option value="move">移动</option><option value="resize">大小</option><option value="use">使用</option></select>
        <button data-action="multi" aria-pressed="false">多选</button>
        <button data-action="undo">撤销</button>
        <button data-action="save">保存</button>
        <button data-action="parameters" aria-expanded="false">参数</button>
        <button data-action="exit">退出</button>
      </div>
      <div data-expanded hidden>
        <div class="layout-mobile-row">
          <select data-range aria-label="选择范围"><option value="group">整组</option><option value="component">组内组件</option><option value="control">单控件</option><option value="element">任意元素</option></select>
          <button data-action="parent">外层</button><button data-action="redo">重做</button>
          <select data-extra aria-label="布局备份与恢复"><option value="">更多</option><option value="recover">所选移回居中</option><option value="export">导出布局</option><option value="import">导入布局</option><option value="reset">还原所选</option><option value="default">全部默认</option><option value="cancel">放弃未保存并退出</option></select>
        </div>
        <div class="layout-mobile-row" data-level-row>
          <span data-name>点选界面</span><select data-hierarchy aria-label="外框和内部内容"></select>
        </div>
        <div class="layout-mobile-fields">
              <label>宽<input data-field="width" type="number" min="16" max="2000" placeholder="自动"></label>
              <label>高<input data-field="height" type="number" min="16" max="2000" placeholder="自动"></label>
              <label>比<input data-field="scale" type="number" min="0.4" max="2.5" step="0.05"></label>
              <label title="首处文字的显示字号px；修改统一所选文字，清空恢复默认">字号<input data-field="fontSize" aria-label="字号（显示像素）" type="number" min="0.1" max="200" step="0.1"></label>
        </div>
        <div class="layout-mobile-row"><label><input data-ratio type="checkbox" checked>整体缩放</label><label><input data-guides type="checkbox" checked>对齐线</label><button data-action="raise">上一层</button><button data-action="lower">下一层</button></div>
        <div data-anchor hidden></div><div data-message role="status"></div>
        <div hidden><button data-action="recover"></button><button data-action="export"></button><button data-action="import"></button><button data-action="reset"></button><button data-action="default"></button><button data-action="cancel"></button><input data-file type="file" accept=".json,application/json"></div>
      </div>
    </section>`;
  doc.body.append(root);
  const $ = (selector) => root.querySelector(selector);
  const cover = $('.layout-mobile-cover'),
    toolbar = $('.layout-mobile-toolbar');
  const outline = $('.layout-mobile-outline'),
    members = $('.layout-mobile-members');
  const button = (action) => $(`[data-action="${action}"]`);
  const selected = () => session.selected.at(-1);
  const node = () => selected() && session.find(selected().selector);
  for (const [handle, x, y] of [
    ['nw', 0, 0],
    ['n', 50, 0],
    ['ne', 100, 0],
    ['e', 100, 50],
    ['se', 100, 100],
    ['s', 50, 100],
    ['sw', 0, 100],
    ['w', 0, 50],
  ]) {
    const b = doc.createElement('button');
    b.dataset.resize = handle;
    b.setAttribute('aria-label', `调整边角 ${handle}`);
    b.style.left = `${x}%`;
    b.style.top = `${y}%`;
    outline.append(b);
  }
  const place = (el, r) =>
    Object.assign(el.style, {
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  const draw = () => {
    const items = session.targets(),
      box = bounds(items);
    outline.hidden = !box || operating;
    members.hidden = outline.hidden || items.length < 2;
    for (const handle of outline.querySelectorAll('[data-resize]'))
      handle.hidden = $('[data-mode]').value !== 'resize';
    if (outline.hidden) return;
    place(outline, box);
    $('[data-anchor]').textContent = anchorLabel(items.at(-1));
    for (const dimension of ['width', 'height']) {
      const input = $(`[data-field="${dimension}"]`);
      if ($('[data-ratio]').checked && doc.activeElement !== input)
        input.value = Math.round(box[dimension]);
    }
    const font = $('[data-field="fontSize"]');
    if (doc.activeElement !== font)
      font.value = fontMetrics(items)?.pixels ?? '';
    members.replaceChildren(
      ...items.map(({ rect }) => {
        const el = doc.createElement('div');
        place(el, rect);
        return el;
      }),
    );
  };
  const sync = () => {
    operating = $('[data-mode]').value === 'use';
    button('multi').setAttribute('aria-pressed', String(additive));
    button('save').textContent = session.dirty ? '保存*' : '保存';
    button('undo').disabled = !session.canUndo;
    button('redo').disabled = !session.canRedo;
    button('raise').disabled = button('lower').disabled = !selected();
    cover.classList.toggle('operating', operating);
    $('[data-message]').textContent = session.message;
    const multi = session.selected.length > 1,
      levels = multi ? [] : hierarchy(node());
    button('parent').disabled = !levels.some((l) => l.relation === 'parent');
    $('[data-name]').textContent = multi
      ? `已选 ${session.selected.length} 项`
      : selected()?.label || '点选界面';
    const list = $('[data-hierarchy]');
    list.replaceChildren(
      ...levels.map((l) => {
        const option = doc.createElement('option');
        option.value = l.selector;
        option.textContent = `${l.relation === 'parent' ? '外框' : l.relation === 'content' ? '内容' : '当前'} · ${l.label}`;
        return option;
      }),
    );
    list.value = selected()?.selector || '';
    list.hidden = multi || !levels.length;
    $('[data-level-row]').hidden = !selected();
    $('[data-anchor]').hidden = !selected();
    const box = bounds(session.targets()),
      value = multi
        ? { width: box?.width, height: box?.height, scale: 1 }
        : selected() && session.entry(selected());
    for (const input of root.querySelectorAll('[data-field]')) {
      input.disabled = !selected();
      if (doc.activeElement === input) continue;
      input.value =
        $('[data-ratio]').checked &&
        ['width', 'height'].includes(input.dataset.field) &&
        box
          ? Math.round(box[input.dataset.field])
          : (value?.[input.dataset.field] ?? '');
    }
    if (doc.activeElement !== $('[data-field="fontSize"]'))
      $('[data-field="fontSize"]').value =
        fontMetrics(session.targets())?.pixels ?? '';
    if (value?.scale != null && doc.activeElement !== $('[data-field="scale"]'))
      $('[data-field="scale"]').value = Math.round(value.scale * 1000) / 1000;
    draw();
  };
  session.subscribe(sync);
  bindGestures({
    cover,
    zoom: () => 1,
    operating: () => operating,
    document: () => doc,
    selectedNode: node,
    targets: session.targets,
    multiple: () => session.selected.length > 1,
    contains: (selector) =>
      session.selected.some((s) => s.selector === selector),
    entry: () => selected() && session.entry(selected()),
    select: session.select,
    granularity: () => $('[data-range]').value,
    additive: () => additive,
    checkpoint: session.checkpoint,
    update: (patch, remember, light) => {
      session.update(patch, remember, light);
      draw();
    },
    updateBatch: (...args) => {
      session.updateBatch(...args);
      draw();
    },
    syncPanels: sync,
    status: session.status,
    snap: () => false,
    ratio: () => $('[data-ratio]').checked,
    interaction: () => $('[data-mode]').value,
    guides: () => $('[data-guides]').checked,
  });
  const close = () => {
    if (closed) return;
    closed = true;
    view.clearInterval(timer);
    view.removeEventListener('resize', keepToolbarVisible);
    view.removeEventListener('beforeunload', beforeUnload);
    session.subscribe(() => {});
    root.remove();
    onClose();
  };
  $('[data-mode]').onchange = sync;
  button('multi').onclick = () => {
    additive = !additive;
    if ($('[data-mode]').value === 'use') $('[data-mode]').value = 'move';
    sync();
  };
  button('save').onclick = () => session.save();
  button('exit').onclick = () => {
    if (!session.dirty || session.save()) {
      session.clearSelection();
      close();
    }
  };
  button('cancel').onclick = () => {
    session.cancel();
    close();
  };
  button('undo').onclick = () => session.history();
  button('redo').onclick = () => session.history(true);
  button('raise').onclick = () => session.stepLayer(1);
  button('lower').onclick = () => session.stepLayer(-1);
  button('reset').onclick = () => session.restore();
  button('default').onclick = () => session.restore(true);
  button('parameters').onclick = () => {
    expanded = !expanded;
    $('[data-expanded]').hidden = !expanded;
    button('parameters').setAttribute('aria-expanded', String(expanded));
    keepToolbarVisible();
  };
  $('[data-extra]').onchange = () => {
    const action = $('[data-extra]').value;
    if (action) button(action).click();
    $('[data-extra]').value = '';
  };
  button('parent').onclick = () => {
    const parent = hierarchy(node())
      .filter((l) => l.relation === 'parent')
      .at(-1);
    if (parent) session.select(parent.selector, parent.label);
  };
  $('[data-hierarchy]').onchange = () => {
    const level = hierarchy(node()).find(
      (l) => l.selector === $('[data-hierarchy]').value,
    );
    if (level) session.select(level.selector, level.label);
  };
  $('[data-range]').onchange = () =>
    session.status(
      $('[data-range]').value === 'component'
        ? '点选组内组件；外层可返回父组'
        : '按当前范围点选界面',
    );
  $('[data-ratio]').onchange = sync;
  for (const input of root.querySelectorAll('[data-field]'))
    input.onchange = () => {
      if (input.dataset.field === 'fontSize') {
        session.setFontSize(input.value === '' ? null : Number(input.value));
        return;
      }
      if (input.dataset.field === 'scale' && session.selected.length === 1) {
        const items = session.targets(),
          box = bounds(items);
        if (box)
          session.updateBatch(items, box, {
            scale: Number(input.value) / items[0].entry.scale,
          });
        return;
      }
      if (
        $('[data-ratio]').checked &&
        ['width', 'height'].includes(input.dataset.field) &&
        input.value !== ''
      ) {
        const items = session.targets(),
          box = bounds(items);
        try {
          session.updateBatch(
            items,
            box,
            dimensionScalePatch(
              items,
              input.dataset.field,
              Number(input.value),
            ),
          );
        } catch (error) {
          session.status(error.message);
        }
        return;
      }
      session.update({
        [input.dataset.field]:
          input.value === '' && input.dataset.field !== 'scale'
            ? null
            : Number(input.value),
      });
    };
  button('recover').onclick = () => {
    const items = session.targets(),
      box = bounds(items);
    if (box)
      session.updateBatch(
        items,
        box,
        alignPatch(
          { dx: 0, dy: 0 },
          box,
          { width: view.innerWidth, height: view.innerHeight },
          'recover',
        ),
      );
  };
  button('export').onclick = async () => {
    const content = JSON.stringify(session.layout, null, 2),
      name = 'shantu-layout-draft.json';
    const file = new view.File([content], name, { type: 'application/json' });
    try {
      if (view.navigator.canShare?.({ files: [file] })) {
        await view.navigator.share({ files: [file] });
        return;
      }
      const { saveFile } = await import('../dataTransfer/download');
      saveFile(name, 'application/json', content);
    } catch (error) {
      session.status(
        error.name === 'AbortError'
          ? '已取消导出'
          : `导出失败：${error.message}`,
      );
    }
  };
  button('import').onclick = () => $('[data-file]').click();
  $('[data-file]').onchange = async () => {
    try {
      const file = $('[data-file]').files[0];
      if (!file) return;
      if (file.size > 256 * 1024) throw Error('布局文件不能超过256KB');
      session.import(await file.text());
    } catch (error) {
      session.status(`导入失败：${error.message}`);
    }
    $('[data-file]').value = '';
  };
  const keepToolbarVisible = () => {
    const r = toolbar.getBoundingClientRect();
    toolbar.style.left = `${Math.max(4, Math.min(r.left, view.innerWidth - r.width - 4))}px`;
    toolbar.style.top = `${Math.max(4, Math.min(r.top, view.innerHeight - r.height - 4))}px`;
  };
  const grip = $('.layout-mobile-grip');
  let start;
  grip.onpointerdown = (e) => {
    start = {
      x: e.clientX,
      y: e.clientY,
      rect: toolbar.getBoundingClientRect(),
    };
    grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  grip.onpointermove = (e) => {
    if (!start) return;
    toolbar.style.left = `${start.rect.left + e.clientX - start.x}px`;
    toolbar.style.top = `${start.rect.top + e.clientY - start.y}px`;
    keepToolbarVisible();
  };
  grip.onpointerup = grip.onpointercancel = () => {
    start = null;
  };
  const beforeUnload = (e) => {
    if (session.dirty) {
      e.preventDefault();
      e.returnValue = '';
    }
  };
  view.addEventListener('beforeunload', beforeUnload);
  view.addEventListener('resize', keepToolbarVisible);
  sync();
  timer = view.setInterval(draw, 400);
  return close;
}
