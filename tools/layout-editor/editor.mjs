import { emptyLayout, validateLayout, layoutCss } from './model.mjs';
import { groups, defaults, visible, pick } from './selection.mjs';
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
function apply() {
  if (doc()?.head) {
    let style = doc().getElementById('shantu-layout-preview-style');
    if (!style) {
      style = doc().createElement('style');
      style.id = 'shantu-layout-preview-style';
      doc().head.append(style);
    }
    style.textContent = layoutCss(layout);
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
  for (const key of ['dx', 'dy', 'width', 'height', 'scale', 'fontSize'])
    $(key).value = e[key] ?? '';
  $('hidden').checked = e.hidden;
}
function select(selector, label) {
  selected = { selector, label };
  properties();
  outline();
}
function refresh() {
  const options = groups.flatMap(([selector, label]) => {
    const node = find(selector);
    return node && visible(node) ? [new Option(label, selector)] : [];
  });
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
function update(patch, remember = true) {
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
  apply();
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
  'hidden',
]) {
  $(key).addEventListener('change', () => {
    try {
      update({
        [key]:
          key === 'hidden'
            ? $(key).checked
            : $(key).value === '' &&
                ['width', 'height', 'fontSize'].includes(key)
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
let gesture;
$('cover').onpointerdown = (event) => {
  if (event.button !== 0 || operating) return;
  const stage = $('cover').getBoundingClientRect();
  const resizing = event.target === $('resize');
  if (!event.target.closest('#outline')) {
    const picked = pick(
      doc(),
      (event.clientX - stage.left) / zoom,
      (event.clientY - stage.top) / zoom,
      $('granularity').value,
    );
    if (!picked) {
      status('这里是地图背景；请点击UI组件，或切换“单个控件”。');
      return;
    }
    select(picked.selector, picked.label);
  }
  const node = selected && find(selected.selector);
  if (!node) return;
  const rect = node.getBoundingClientRect(),
    e = { ...entry() };
  gesture = {
    x: event.clientX,
    y: event.clientY,
    e,
    rect,
    resizing,
    started: false,
  };
  $('cover').setPointerCapture(event.pointerId);
  event.preventDefault();
};
$('cover').onpointermove = (event) => {
  if (!gesture) return;
  const g = gesture,
    dx = (event.clientX - g.x) / zoom,
    dy = (event.clientY - g.y) / zoom;
  if (!g.started && Math.abs(dx) + Math.abs(dy) < 3) return;
  if (!g.started) {
    checkpoint();
    g.started = true;
  }
  const round = (n) =>
    $('snap').checked ? Math.round(n / 4) * 4 : Math.round(n);
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  if (g.resizing) {
    const width = clamp(round((g.rect.width + dx) / g.e.scale), 16, 2000);
    const height = clamp(
      round(
        $('ratio').checked
          ? (width * g.rect.height) / g.rect.width
          : (g.rect.height + dy) / g.e.scale,
      ),
      16,
      2000,
    );
    update({ width, height }, false);
  } else
    update(
      {
        dx: clamp(round(g.e.dx + dx), -3000, 3000),
        dy: clamp(round(g.e.dy + dy), -3000, 3000),
      },
      false,
    );
};
const endGesture = () => {
  gesture = null;
};
$('cover').onpointerup = endGesture;
$('cover').onpointercancel = endGesture;
$('cover').onkeydown = (event) => {
  if (
    !selected ||
    !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
  )
    return;
  event.preventDefault();
  const e = entry(),
    step = event.shiftKey ? 10 : 1;
  update({
    dx: Math.max(
      -3000,
      Math.min(
        3000,
        e.dx +
          (event.key === 'ArrowRight'
            ? step
            : event.key === 'ArrowLeft'
              ? -step
              : 0),
      ),
    ),
    dy: Math.max(
      -3000,
      Math.min(
        3000,
        e.dy +
          (event.key === 'ArrowDown'
            ? step
            : event.key === 'ArrowUp'
              ? -step
              : 0),
      ),
    ),
  });
};
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
  if (!gesture) outline();
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
