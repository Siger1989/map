export const groups = [
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
export function describe(element) {
  return (
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
  let element = doc.elementFromPoint(x, y);
  if (!element) return null;
  if (granularity === 'control') {
    element = element.closest(
      'button,input,select,textarea,a,[role="slider"],label,summary',
    );
    if (element)
      return {
        element,
        selector: selectorFor(element, doc),
        label: describe(element),
      };
    return null;
  }
  for (
    let node = element;
    node && node !== doc.body;
    node = node.parentElement
  ) {
    const group = groups.find(([selector]) => node.matches(selector));
    if (group)
      return {
        element: node,
        selector:
          doc.querySelectorAll(group[0]).length === 1
            ? group[0]
            : selectorFor(node, doc),
        label: group[1],
      };
  }
  return null;
}

/** List covered controls too; their boxes exist even when another panel is in front. */
export function selectable(doc, granularity, query = '') {
  if (!doc?.body) return [];
  const candidates =
    granularity === 'control'
      ? [
          ...doc.querySelectorAll(
            'button,input:not([type="hidden"]),select,textarea,a,[role="slider"],summary',
          ),
        ]
          .filter(visible)
          .map((element) => ({
            element,
            selector: selectorFor(element, doc),
            label: describe(element),
          }))
      : groups.flatMap(([selector, label]) =>
          [...doc.querySelectorAll(selector)]
            .filter(visible)
            .map((element) => ({
              element,
              selector:
                doc.querySelectorAll(selector).length === 1
                  ? selector
                  : selectorFor(element, doc),
              label,
            })),
        );
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (
      seen.has(candidate.selector) ||
      !candidate.label.toLowerCase().includes(query.trim().toLowerCase())
    )
      return false;
    seen.add(candidate.selector);
    return true;
  });
}
