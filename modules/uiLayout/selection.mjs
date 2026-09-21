export const groups = [
  ['.home-topbar', '顶部栏'],
  ['.home-map-actions', '右侧地图工具'],
  ['.home-position-dock > .position-dock-button', '定位入口'],
  ['.home-bottom-nav', '底部导航'],
  ['.home-route-card', '路线规划卡片'],
  ['.home-recording', '快捷记录'],
  ['.topbar', '顶部栏'],
  ['.map-actions', '右侧地图工具'],
  ['.camera-gizmo', '视角方向盘'],
  ['.position-dock > .position-dock-button', '定位入口'],
  ['.route-display-control > .position-dock-button', '海拔显示入口'],
  ['.position-dock-coordinates', '定位坐标'],
  ['.position-status', '定位提示'],
  ['.recording-quick', '快捷记录'],
  ['.dock-navigation', '底部导航'],
  ['.weather-summary', '天气海拔入口'],
  ['.route-display-info', '路线信息组合'],
  ['.route-color-legend', '路线颜色图例'],
  ['.route-elevation-stats', '海拔统计'],
  ['.route-elevation-profile', '海拔剖面'],
  ['.route-display-settings', '路线显示设置'],
  ['#map-control-panel', '功能浮窗'],
  ['.route-card', '路线规划卡片'],
  ['.route-details', '路线详情'],
  ['.route-dialog', '路线对话框'],
  ['.annotation-panel', '标记编辑'],
  ['.object-gizmo', '模型精调'],
  ['.guidance-card', '导航指引'],
  ['.track-journey-rail', '路线进度条'],
  ['.route-edit-header', '路线编辑标题'],
  ['.route-edit-dock', '路线编辑工具'],
  ['.layer-window-entry', '图层入口'],
  ['.map-location-settings', '定位设置'],
  ['.track-tools', '绘制工具栏'],
  ['.track-drawing-style', '画线外观'],
  ['.track-node-toolbar', '轨迹节点工具'],
];
export const defaults = (selector, label) => ({
  selector,
  label,
  dx: 0,
  dy: 0,
  width: null,
  height: null,
  scale: 1,
  fontSize: null,
  hidden: false,
});
export function visible(element) {
  const r = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView.getComputedStyle(element);
  return r.width > 0 && r.height > 0 && style.visibility !== 'hidden';
}
const controls =
  'button,input:not([type="hidden"]),select,textarea,a,[role="slider"],label,summary';
const structural =
  'html,body,main,#root,#__next,.observatory,.maplibregl-map,.maplibregl-canvas-container';
export const componentWrappers =
  '.control-dock,.position-dock,.home-position-dock,.route-display-control';
const nonUI =
  'script,style,link,meta,template,option,.maplibregl-canvas,[data-layout-ignore]';
const semanticGroups =
  'section,aside,nav,dialog,form,fieldset,[role="toolbar"],[role="dialog"],[role="group"],[role="status"],[role="alert"],.glass,[aria-label],[aria-labelledby]';
function eligible(element) {
  return (
    !!element &&
    !element.matches(structural) &&
    !element.closest(nonUI) &&
    (element.namespaceURI !== 'http://www.w3.org/2000/svg' ||
      element.localName === 'svg')
  );
}
function component(element) {
  if (!eligible(element) || element.matches(componentWrappers)) return false;
  // An accessible chart/icon label describes its content, not another UI frame.
  // Keep SVG selection available in element mode and the hierarchy instead.
  if (element.namespaceURI === 'http://www.w3.org/2000/svg') return false;
  if (groups.some(([selector]) => element.matches(selector))) return true;
  if (element.matches(controls)) return false;
  return (
    element.matches(semanticGroups) ||
    [...element.classList].some((c) =>
      /(?:^|-)(?:panel|popover|toolbar|tools|card|dock|window)$/.test(c),
    )
  );
}
export function describe(element) {
  const known = groups.find(([selector]) => element.matches(selector));
  const labelled = element
    .getAttribute('aria-labelledby')
    ?.split(/\s+/)
    .map((id) => element.ownerDocument.getElementById(id)?.textContent)
    .filter(Boolean)
    .join(' ');
  return (
    known?.[1] ||
    labelled ||
    element.getAttribute('aria-label') ||
    element.getAttribute('title') ||
    element.textContent?.trim().replace(/\s+/g, ' ') ||
    element.tagName
  ).slice(0, 120);
}
export function selectorFor(element, doc) {
  const escape = doc.defaultView.CSS.escape;
  if (element.id) return `#${escape(element.id)}`;
  const known = groups.find(
    ([selector]) =>
      element.matches(selector) && doc.querySelectorAll(selector).length === 1,
  );
  if (known) return known[0];
  const uniqueClass = [...element.classList].find(
    (c) =>
      !/^(active|open|selected|glass|is-|has-)/.test(c) &&
      doc.querySelectorAll(`.${escape(c)}`).length === 1,
  );
  if (uniqueClass) return `.${escape(uniqueClass)}`;
  const aria = element.getAttribute('aria-label');
  if (aria && !/[{};<>@]/.test(aria)) {
    const candidate = `${element.localName}[aria-label=${JSON.stringify(aria)}]`;
    if (doc.querySelectorAll(candidate).length === 1) return candidate;
  }
  const parts = [];
  for (
    let node = element;
    node && node !== doc.body;
    node = node.parentElement
  ) {
    if (node.id) {
      parts.unshift(`#${escape(node.id)}`);
      break;
    }
    const stable = [...node.classList].find(
      (c) => !/^(active|open|selected|glass|is-|has-)/.test(c),
    );
    if (stable && doc.querySelectorAll(`.${escape(stable)}`).length === 1) {
      parts.unshift(`.${escape(stable)}`);
      break;
    }
    const siblings = [...node.parentElement.children].filter(
      (n) => n.localName === node.localName,
    );
    parts.unshift(
      `${node.localName}:nth-of-type(${siblings.indexOf(node) + 1})`,
    );
  }
  return parts.join(' > ');
}
export function pick(doc, x, y, granularity) {
  let element =
    doc
      .elementsFromPoint?.(x, y)
      .find((node) => !node.closest('[data-layout-ignore]')) ??
    doc.elementFromPoint(x, y);
  if (!element) return null;
  if (granularity === 'control') {
    element = element.closest(controls);
    return eligible(element) ? candidate(element, doc) : null;
  }
  if (granularity === 'element') {
    if (element.namespaceURI === 'http://www.w3.org/2000/svg')
      element = element.closest('svg');
    return eligible(element) ? candidate(element, doc) : null;
  }
  let outer = null;
  for (
    let node = element;
    node && node !== doc.body;
    node = node.parentElement
  ) {
    if (
      granularity === 'component' &&
      eligible(node) &&
      visible(node) &&
      (component(node) || node.matches(controls))
    )
      return candidate(node, doc);
    if (component(node) && visible(node)) outer = node;
  }
  return outer ? candidate(outer, doc) : null;
}

function candidate(element, doc = element.ownerDocument) {
  return {
    element,
    selector: selectorFor(element, doc),
    label: describe(element),
  };
}

/** Expose real container ancestry and nested content without requiring a registry entry. */
export function hierarchy(element) {
  if (!element) return [];
  const result = [];
  for (
    let node = element;
    node && node !== element.ownerDocument.body;
    node = node.parentElement
  ) {
    if (eligible(node) && visible(node))
      result.unshift({
        ...candidate(node),
        relation: node === element ? 'current' : 'parent',
      });
  }
  for (const child of element.querySelectorAll('*')) {
    if (
      eligible(child) &&
      visible(child) &&
      (component(child) ||
        child.matches(controls) ||
        child.parentElement === element)
    )
      result.push({ ...candidate(child), relation: 'content' });
  }
  return result;
}

/** A selected child follows its selected ancestor exactly once. */
export function selectionRoots(items) {
  return items.filter(
    ({ element }) =>
      !items.some(
        (other) => other.element !== element && other.element.contains(element),
      ),
  );
}

/** List covered controls too; their boxes exist even when another panel is in front. */
export function selectable(doc, granularity, query = '') {
  if (!doc?.body) return [];
  const candidates = [
    ...doc.body.querySelectorAll(granularity === 'control' ? controls : '*'),
  ]
    .filter(
      (element) =>
        eligible(element) &&
        (granularity !== 'group' || component(element)) &&
        (granularity !== 'component' ||
          component(element) ||
          element.matches(controls)) &&
        visible(element),
    )
    .map((element) => candidate(element, doc));
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (
      seen.has(candidate.selector) ||
      !`${candidate.label} ${candidate.selector}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    )
      return false;
    seen.add(candidate.selector);
    return true;
  });
}
