import { emptyLayout, validateLayout } from './model.mjs';
import {
  defaults,
  visible,
  selectable,
  hierarchy,
  selectionRoots,
} from './selection.mjs';
import {
  alignPatch,
  elementScale,
  capture,
  bounds,
  batchPatches,
  dimensionScalePatch,
  fontMetrics,
  fontSizePatches,
} from './geometry.mjs';
import { bindGestures } from './gestures.mjs';
import { layerPatches, layerTargets } from './layers.mjs';
import { bindLayoutActions, downloadLayout } from './transfer.mjs';
import {
  captureAnchor,
  anchoredEntries,
  anchorLabel,
  rebaseChildAnchors,
  anchorBatchTargets,
} from './anchors.mjs';
import {
  renderAnchoredLayout,
  observeAnchoredLayout,
} from './anchorRenderer.mjs';
const $ = (id) => document.getElementById(id);
const frame = $('preview');
let selection = [],
  spacePreview = false;
let layout = emptyLayout(),
  saved = '',
  selected = null,
  operating = false,
  zoom = 0.8,
  busy = false;
const past = [],
  future = [];
let effective = new Map(),
  anchorObserver;
const serial = () => JSON.stringify(layout);
const status = (message) => {
  $('status').textContent = message;
};
const doc = () => frame.contentDocument;
function checkpoint() {
  past.push(serial());
  if (past.length > 50) past.shift();
  future.length = 0;
}
function find(selector) {
  try {
    return doc()?.querySelector(selector);
  } catch {
    return null;
  }
}
function entry(target = selected) {
  return (
    effective.get(target?.selector) ||
    layout.entries.find((e) => e.selector === target?.selector) ||
    (target && defaults(target.selector, target.label))
  );
}
function targets() {
  return selectionRoots(
    selection
      .map((s) => ({ ...s, element: find(s.selector) }))
      .filter((s) => s.element && visible(s.element)),
  ).map((s) => capture(s.element, entry(s)));
}
function syncSelectionList() {
  for (const option of $('widgets').options)
    option.selected = selection.some((s) => s.selector === option.value);
}
function outline() {
  const items = targets(),
    r = bounds(items);
  $('outline').hidden =
    !r || operating || spacePreview || !$('show-outline').checked;
  $('member-outlines').hidden = $('outline').hidden || items.length < 2;
  if ($('outline').hidden) return;
  Object.assign($('outline').style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
  for (const dimension of ['width', 'height'])
    if ($('ratio').checked && document.activeElement !== $(dimension))
      $(dimension).value = Math.round(r[dimension]);
  if (document.activeElement !== $('fontSize'))
    $('fontSize').value = fontMetrics(items)?.pixels ?? '';
  $('outline-label').textContent =
    selection.length > 1 ? `${selection.length} 项 · 整体调整` : selected.label;
  $('move-selection').hidden =
    !$('show-label').checked || $('interaction').value !== 'move';
  for (const handle of document.querySelectorAll('[data-resize]'))
    handle.hidden = $('interaction').value !== 'resize';
  $('member-outlines').replaceChildren(
    ...items.map(({ rect }) => {
      const box = document.createElement('div');
      Object.assign(box.style, {
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
      return box;
    }),
  );
}
function apply(light = false) {
  if (doc()?.head) {
    let style = doc().getElementById('shantu-layout-preview-style');
    if (!style) {
      style = doc().createElement('style');
      style.id = 'shantu-layout-preview-style';
      doc().head.append(style);
    }
    effective = renderAnchoredLayout(doc(), style, layout);
    anchorObserver?.watch(
      layout.entries.filter((e) => e.anchor).map((e) => find(e.selector)),
    );
  }
  if (light) {
    outline();
    return;
  }
  $('undo').disabled = !past.length;
  $('redo').disabled = !future.length;
  $('save').textContent =
    serial() === saved ? '已保存 · 保存到项目' : '保存到项目 *';
  $('changes').replaceChildren(
    ...layout.entries.map(
      (e) =>
        new Option(
          `${e.hidden ? '隐藏 · ' : ''}${e.label}${find(e.selector) ? '' : '（未打开）'}`,
          e.selector,
        ),
    ),
  );
  if (selected) $('changes').value = selected.selector;
  outline();
}
function canvas() {
  const { width, height } = layout.viewport;
  Object.assign($('stage').style, {
    width: `${width}px`,
    height: `${height}px`,
    transform: `scale(${zoom})`,
  });
  $('stage').style.setProperty('--inverse-zoom', String(1 / zoom));
  Object.assign($('phone').style, {
    width: `${width * zoom}px`,
    height: `${height * zoom}px`,
  });
  const value = `${width},${height}`;
  if (![...$('viewport').options].some((o) => o.value === value))
    $('viewport').add(new Option(`${width} × ${height}`, value));
  $('viewport').value = value;
  $('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  $('zoom').value = $('zoom-number').value = String(Math.round(zoom * 100));
  requestAnimationFrame(outline);
}
function properties() {
  $('properties').disabled = !selected;
  if (!selected) {
    $('selected-name').textContent = '选择一个组件';
    $('hierarchy').replaceChildren();
    $('select-parent').disabled = true;
    return;
  }
  const multiple = selection.length > 1,
    box = bounds(targets());
  const e = multiple
      ? {
          dx: 0,
          dy: 0,
          width: box?.width,
          height: box?.height,
          scale: 1,
          hidden: false,
        }
      : entry(),
    node = find(selected.selector);
  $('selected-name').textContent = multiple
    ? `已选 ${selection.length} 项`
    : e.label;
  $('selected-description').textContent = multiple
    ? '统一移动或缩放；批量偏移以本次选择为起点。父子同时选中时只调整外层。'
    : node
      ? '相对默认布局调整；空宽高保持自适应。'
      : '该组件尚未打开，请先操作页面进入对应功能。';
  for (const key of [
    'dx',
    'dy',
    'width',
    'height',
    'scale',
    'fontSize',
    'zIndex',
  ])
    $(key).value =
      $('ratio').checked && ['width', 'height'].includes(key) && box
        ? Math.round(box[key])
        : (e[key] ?? '');
  $('hidden').checked = e.hidden;
  $('fontSize').value = fontMetrics(targets())?.pixels ?? e.fontSize ?? '';
  $('anchor-status').textContent = anchorLabel(targets().at(-1));
  const layers = layerTargets(
    targets(),
    $('layer-scope').value,
    layout.entries,
  );
  const lastLayer = layers.at(-1);
  $('zIndex').value =
    lastLayer?.entry.zIndex ??
    (lastLayer
      ? Number.parseInt(
          doc().defaultView.getComputedStyle(lastLayer.element).zIndex,
          10,
        ) || 0
      : '');
  $('layer-target').textContent =
    `调整：${layers.map((l) => l.entry.label).join('、')}`;
  $('dx-label').textContent = multiple ? '一起水平移动 px' : '水平偏移 px';
  $('dy-label').textContent = multiple ? '一起垂直移动 px' : '垂直偏移 px';
  $('scale-label').textContent = multiple ? '本次整体缩放倍数' : '整体比例';
  const levels = multiple ? [] : hierarchy(node);
  $('hierarchy').replaceChildren(
    ...levels.map(
      (level) =>
        new Option(
          `${level.relation === 'parent' ? '外框' : level.relation === 'content' ? '内容' : '当前'} · ${level.label}`,
          level.selector,
        ),
    ),
  );
  $('hierarchy').value = selected.selector;
  $('select-parent').disabled = !levels.some((l) => l.relation === 'parent');
}
function select(selector, label, toggle = false) {
  if (toggle) {
    selection = selection.some((s) => s.selector === selector)
      ? selection.filter((s) => s.selector !== selector)
      : [...selection, { selector, label }];
  } else selection = [{ selector, label }];
  selected = selection.at(-1) ?? null;
  properties();
  outline();
  syncSelectionList();
}
function refresh() {
  const options = selectable(
    doc(),
    $('granularity').value,
    $('search').value,
  ).map(({ selector, label }) => new Option(label, selector));
  if (
    options.map((o) => o.value).join('|') !==
    [...$('widgets').options].map((o) => o.value).join('|')
  ) {
    $('widgets').replaceChildren(...options);
    syncSelectionList();
  }
  outline();
}
function update(patch, remember = true, light = false) {
  if (!selected) return;
  if (
    selection.length === 1 &&
    ['dx', 'dy', 'width', 'height', 'scale'].some((key) => key in patch)
  ) {
    const items = targets(),
      box = bounds(items);
    if (!box) return;
    const relative = { ...patch };
    for (const key of ['dx', 'dy'])
      if (key in patch) relative[key] -= items[0].entry[key];
    if (patch.scale != null)
      relative.scale = patch.scale / items[0].entry.scale;
    updateBatch(items, box, relative, remember, light);
    return;
  }
  if (selection.length > 1) {
    const items = targets(),
      box = bounds(items);
    if (box) updateBatch(items, box, patch, remember, light);
    return;
  }
  const next = { ...entry(), ...patch };
  const candidate = validateLayout({
    ...layout,
    entries: [
      ...layout.entries.filter((e) => e.selector !== next.selector),
      next,
    ],
  });
  if (remember) checkpoint();
  layout = candidate;
  apply(light);
  if (light) return;
  properties();
  status('修改尚未保存；可以撤销或继续调整。');
}
function replaceEntries(entries) {
  const updates = new Map(entries.map((e) => [e.selector, e]));
  layout = validateLayout({
    ...layout,
    entries: [
      ...layout.entries.filter((e) => !updates.has(e.selector)),
      ...updates.values(),
    ],
  });
}
function updateBatch(
  items,
  box,
  patch,
  remember = true,
  light = false,
  placement = 'anchor',
) {
  if (!items.length) return;
  const changes = batchPatches(items, box, patch);
  const resizing = ['width', 'height', 'scale'].some(
      (key) => patch[key] != null,
    ),
    fixedEdge = resizing && items.length === 1 && placement !== 'pointer';
  const geometric = resizing || 'dx' in patch || 'dy' in patch;
  if (placement !== 'pointer') anchorBatchTargets(items, box, patch, changes);
  for (const change of changes)
    change.next.anchor = fixedEdge
      ? (items[0].entry.anchor ??
        captureAnchor(items[0].element, items[0].rect))
      : geometric
        ? undefined
        : change.entry.anchor;
  const before = serial();
  try {
    if (remember) checkpoint();
    replaceEntries([
      ...(geometric ? rebaseChildAnchors(doc(), layout.entries, items) : []),
      ...changes.map((c) => c.next),
    ]);
    apply(true);
    if (resizing && !fixedEdge) {
      // Apply every size first, then compensate flex/right/bottom anchoring together.
      replaceEntries(
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
    apply(true);
    replaceEntries(
      anchoredEntries(
        doc(),
        changes.map((c) => effective.get(c.next.selector) ?? c.next),
        effective,
      ),
    );
    apply(light);
    if (!light) {
      properties();
      status(`已一起调整 ${items.length} 个外层组件；修改尚未保存。`);
    }
  } catch (error) {
    layout = JSON.parse(before);
    if (remember) past.pop();
    apply();
    status(error.message);
  }
}
for (const key of [
  'dx',
  'dy',
  'width',
  'height',
  'scale',
  'fontSize',
  'zIndex',
  'hidden',
]) {
  $(key).addEventListener('change', () => {
    try {
      if (key === 'zIndex') {
        const changes = layerTargets(
          targets(),
          $('layer-scope').value,
          layout.entries,
        ).map(({ entry }) => ({
          ...entry,
          zIndex: $(key).value === '' ? null : Number($(key).value),
        }));
        checkpoint();
        replaceEntries(changes);
        apply();
        properties();
        return;
      }
      if (key === 'fontSize') {
        const changes = fontSizePatches(
          targets(),
          $(key).value === '' ? null : Number($(key).value),
        );
        if (!changes.length) return;
        checkpoint();
        replaceEntries(changes);
        apply();
        properties();
        status('字号已更新，修改尚未保存。');
        return;
      }
      if (key === 'scale' && selection.length === 1) {
        const items = targets(),
          box = bounds(items);
        if (box)
          updateBatch(items, box, {
            scale: Number($(key).value) / items[0].entry.scale,
          });
        return;
      }
      if (
        $('ratio').checked &&
        ['width', 'height'].includes(key) &&
        $(key).value !== ''
      ) {
        const items = targets(),
          box = bounds(items);
        updateBatch(
          items,
          box,
          dimensionScalePatch(items, key, Number($(key).value)),
        );
        return;
      }
      update({
        [key]:
          key === 'hidden'
            ? $(key).checked
            : $(key).value === '' &&
                ['width', 'height', 'fontSize', 'zIndex'].includes(key)
              ? null
              : Number($(key).value),
      });
    } catch (error) {
      status(error.message);
      properties();
    }
  });
}
$('widgets').onchange = () => {
  selection = [...$('widgets').selectedOptions].map((o) => ({
    selector: o.value,
    label: o.textContent,
  }));
  selected = selection.at(-1) ?? null;
  properties();
  outline();
};
$('hierarchy').onchange = () => {
  const level = hierarchy(selected && find(selected.selector)).find(
    (l) => l.selector === $('hierarchy').value,
  );
  if (level) select(level.selector, level.label);
};
$('select-parent').onclick = () => {
  const parent = hierarchy(selected && find(selected.selector))
    .filter((l) => l.relation === 'parent')
    .at(-1);
  if (parent) select(parent.selector, parent.label);
};
$('changes').onchange = () => {
  const e = layout.entries.find((e) => e.selector === $('changes').value);
  if (e) select(e.selector, e.label);
};
$('refresh').onclick = refresh;
$('search').oninput = refresh;
$('granularity').onchange = () => {
  selected = null;
  selection = [];
  properties();
  refresh();
};
document.querySelectorAll('[data-align]').forEach(
  (button) =>
    (button.onclick = () => {
      if (selection.length > 1) {
        const items = targets(),
          box = bounds(items);
        if (box)
          updateBatch(
            items,
            box,
            alignPatch(
              { dx: 0, dy: 0 },
              box,
              layout.viewport,
              button.dataset.align,
            ),
          );
        return;
      }
      const node = selected && find(selected.selector);
      if (!node || !visible(node)) {
        status('请先打开该组件，再进行对齐。');
        return;
      }
      update(
        alignPatch(
          entry(),
          node.getBoundingClientRect(),
          layout.viewport,
          button.dataset.align,
          elementScale(node).parentScale,
        ),
      );
    }),
);
function stepLayer(direction) {
  if (!selected) return;
  const changes = layerPatches(
    targets(),
    direction,
    $('layer-scope').value,
    layout.entries,
  );
  checkpoint();
  replaceEntries(changes);
  apply();
  properties();
}
$('raise').onclick = () => stepLayer(1);
$('lower').onclick = () => stepLayer(-1);
$('layer-scope').onchange = properties;
$('interaction').onchange = outline;
$('mode').onclick = () => {
  operating = !operating;
  $('cover').classList.toggle('operating', operating);
  $('mode').textContent = operating ? '正在操作页面' : '正在选择布局';
  status(
    operating
      ? '现在可点击地图里的功能。打开面板后，再点此按钮切回选择布局。'
      : '点击组件选择，拖动蓝框移动。',
  );
  refresh();
};
$('viewport').onchange = () => {
  checkpoint();
  const [width, height] = $('viewport').value.split(',').map(Number);
  layout.viewport = { width, height };
  canvas();
  apply();
};
function setZoom(percent) {
  if (!Number.isFinite(percent)) return;
  const workspace = document.querySelector('.workspace'),
    previous = zoom;
  const focus = bounds(targets());
  zoom = Math.max(0.4, Math.min(2.5, percent / 100));
  canvas();
  if (focus) {
    workspace.scrollLeft = Math.max(
      0,
      (focus.left + focus.width / 2) * zoom - workspace.clientWidth / 2 + 26,
    );
    workspace.scrollTop = Math.max(
      0,
      (focus.top + focus.height / 2) * zoom - workspace.clientHeight / 2 + 26,
    );
  } else {
    workspace.scrollLeft *= zoom / previous;
    workspace.scrollTop *= zoom / previous;
  }
}
$('zoom').oninput = () => setZoom(Number($('zoom').value));
$('zoom-number').onchange = () => setZoom(Number($('zoom-number').value));
document.querySelectorAll('[data-zoom]').forEach((button) => {
  button.onclick = () => setZoom(Number(button.dataset.zoom));
});
$('ratio').onchange = properties;
$('show-outline').onchange = $('show-label').onchange = outline;
window.addEventListener('keydown', (event) => {
  if (operating || event.target.closest('input,select,textarea,button,a'))
    return;
  if (event.code === 'Space') {
    event.preventDefault();
    spacePreview = true;
    outline();
  }
  if (event.key === 'Escape') {
    selection = [];
    selected = null;
    properties();
    outline();
    syncSelectionList();
  }
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') {
    spacePreview = false;
    outline();
  }
});
window.addEventListener('blur', () => {
  spacePreview = false;
  outline();
});
$('reset').onclick = () => {
  if (!selected) return;
  checkpoint();
  layout.entries = layout.entries.filter(
    (e) => !selection.some((s) => s.selector === e.selector),
  );
  apply();
  properties();
  status('已恢复该组件，保存后生效。');
};
function history(from, to) {
  if (!from.length) return;
  to.push(serial());
  layout = JSON.parse(from.pop());
  canvas();
  apply();
  properties();
}
$('undo').onclick = () => history(past, future);
$('redo').onclick = () => history(future, past);
const isDragging = bindGestures({
  cover: $('cover'),
  zoom: () => zoom,
  operating: () => operating,
  document: doc,
  selectedNode: () => selected && find(selected.selector),
  targets,
  multiple: () => selection.length > 1,
  contains: (selector) => selection.some((s) => s.selector === selector),
  updateBatch,
  entry,
  select,
  granularity: () => $('granularity').value,
  checkpoint,
  update,
  syncPanels: () => {
    apply();
    properties();
  },
  status,
  snap: () => $('snap').checked,
  ratio: () => $('ratio').checked,
  interaction: () => $('interaction').value,
  guides: () => $('guides').checked,
});
$('save').onclick = async () => {
  if (busy) return;
  busy = true;
  $('save').disabled = true;
  layout.entries = anchoredEntries(doc(), layout.entries, effective);
  const snapshot = serial();
  try {
    const response = await fetch('/__layout/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shantu-Layout': '1' },
      body: snapshot,
    });
    const result = await response.json();
    if (!response.ok) throw Error(result.error);
    saved = snapshot;
    apply();
    status(`已保存到 ${result.path}，下次打开自动载入。`);
  } catch (error) {
    status(`保存失败：${error.message}`);
  } finally {
    busy = false;
    $('save').disabled = false;
  }
};
$('export').onclick = () => {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(layout, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = 'shantu-layout-draft.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('import').onchange = async () => {
  try {
    const file = $('import').files[0];
    if (!file) return;
    if (file.size > 256 * 1024) throw Error('文件不能超过256KB');
    const next = validateLayout(JSON.parse(await file.text()));
    checkpoint();
    layout = next;
    selected = null;
    selection = [];
    canvas();
    apply();
    properties();
    status(`已载入 ${layout.entries.length} 项修改；点击保存写入项目。`);
  } catch (error) {
    status(`导入失败：${error.message}`);
  }
  $('import').value = '';
};
let frameObserver, refreshTimer, unbindFrameActions;
frame.addEventListener('load', () => {
  unbindFrameActions?.();
  unbindFrameActions = bindLayoutActions(doc().defaultView, {
    edit: () => {
      if (operating) $('mode').click();
      return '请在控制器中调整当前布局';
    },
    export: () =>
      downloadLayout({
        ...layout,
        entries: anchoredEntries(doc(), layout.entries, effective),
      }),
    import: (raw) => {
      const next = validateLayout(JSON.parse(raw));
      checkpoint();
      layout = next;
      canvas();
      apply();
      refresh();
      return '已导入预览，点击保存到项目后保留';
    },
  });
  frameObserver?.disconnect();
  anchorObserver?.dispose();
  anchorObserver = observeAnchoredLayout(doc(), () => apply(true));
  apply();
  refresh();
  frameObserver = new MutationObserver(() => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(refresh, 120);
  });
  if (doc()?.body)
    frameObserver.observe(doc().body, { childList: true, subtree: true });
});
window.addEventListener('beforeunload', (event) => {
  if (saved && serial() !== saved) {
    event.preventDefault();
    event.returnValue = '';
  }
});
setInterval(() => {
  if (!isDragging()) outline();
}, 400);
try {
  const response = await fetch('/__layout/draft'),
    data = await response.json();
  if (!response.ok) throw Error(data.error);
  layout = validateLayout(data);
  saved = serial();
  zoom = Math.max(
    0.4,
    Math.min(
      0.8,
      (window.innerHeight -
        document.querySelector('header').offsetHeight -
        56) /
        layout.viewport.height,
    ),
  );
  $('zoom').value = String(Math.round(zoom * 100));
  canvas();
  apply();
  refresh();
  status('已载入布局草稿。修改后点击“保存到项目”。');
} catch (error) {
  canvas();
  status(`草稿未载入：${error.message}。原文件未被覆盖。`);
}
