import { emptyLayout, validateLayout, layoutCss } from './model.mjs';
import { defaults, visible, selectable } from './selection.mjs';
import { alignPatch, elementScale } from './geometry.mjs';
import { bindGestures } from './gestures.mjs';
const $ = (id) => document.getElementById(id);
const frame = $('preview');
let layout = emptyLayout(),
  saved = '',
  selected = null,
  operating = false,
  zoom = 0.8,
  busy = false;
const past = [],
  future = [];
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
function entry() {
  return (
    layout.entries.find((e) => e.selector === selected?.selector) ||
    (selected && defaults(selected.selector, selected.label))
  );
}
function outline() {
  const node = selected && find(selected.selector);
  $('outline').hidden = !node || !visible(node) || operating;
  if ($('outline').hidden) return;
  const r = node.getBoundingClientRect();
  Object.assign($('outline').style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
  $('outline-label').textContent = selected.label;
}
function apply(light = false) {
  if (doc()?.head) {
    let style = doc().getElementById('shantu-layout-preview-style');
    if (!style) {
      style = doc().createElement('style');
      style.id = 'shantu-layout-preview-style';
      doc().head.append(style);
    }
    style.textContent = layoutCss(layout);
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
  Object.assign($('phone').style, {
    width: `${width * zoom}px`,
    height: `${height * zoom}px`,
  });
  const value = `${width},${height}`;
  if (![...$('viewport').options].some((o) => o.value === value))
    $('viewport').add(new Option(`${width} × ${height}`, value));
  $('viewport').value = value;
  $('zoom-value').textContent = `${Math.round(zoom * 100)}%`;
  requestAnimationFrame(outline);
}
function properties() {
  $('properties').disabled = !selected;
  if (!selected) {
    $('selected-name').textContent = '选择一个组件';
    return;
  }
  const e = entry(),
    node = find(e.selector);
  $('selected-name').textContent = e.label;
  $('selected-description').textContent = node
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
    $(key).value = e[key] ?? '';
  $('hidden').checked = e.hidden;
}
function select(selector, label) {
  selected = { selector, label };
  properties();
  outline();
  $('widgets').value = selector;
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
    const value = $('widgets').value;
    $('widgets').replaceChildren(...options);
    $('widgets').value = value;
  }
  outline();
}
function update(patch, remember = true, light = false) {
  if (!selected) return;
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
$('widgets').onchange = () =>
  select($('widgets').value, $('widgets').selectedOptions[0].textContent);
$('changes').onchange = () => {
  const e = layout.entries.find((e) => e.selector === $('changes').value);
  if (e) select(e.selector, e.label);
};
$('refresh').onclick = refresh;
$('search').oninput = refresh;
$('granularity').onchange = () => {
  selected = null;
  properties();
  refresh();
};
document.querySelectorAll('[data-align]').forEach(
  (button) =>
    (button.onclick = () => {
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
$('raise').onclick = () => {
  if (!selected) return;
  update({
    zIndex: Math.min(
      99999,
      Math.max(100, ...layout.entries.map((e) => e.zIndex ?? 0)) + 1,
    ),
  });
};
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
$('zoom').oninput = () => {
  zoom = Number($('zoom').value) / 100;
  canvas();
};
$('reset').onclick = () => {
  if (!selected) return;
  checkpoint();
  layout.entries = layout.entries.filter(
    (e) => e.selector !== selected.selector,
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
});
$('save').onclick = async () => {
  if (busy) return;
  busy = true;
  $('save').disabled = true;
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
    canvas();
    apply();
    properties();
    status(`已载入 ${layout.entries.length} 项修改；点击保存写入项目。`);
  } catch (error) {
    status(`导入失败：${error.message}`);
  }
  $('import').value = '';
};
let frameObserver, refreshTimer;
frame.addEventListener('load', () => {
  frameObserver?.disconnect();
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
