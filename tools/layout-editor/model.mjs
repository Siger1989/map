export const emptyLayout = () => ({
  format: 'shantu-layout-draft',
  version: 1,
  viewport: { width: 390, height: 844 },
  entries: [],
});
export function validateLayout(value) {
  const v = value;
  const number = (n, min, max) =>
    typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  if (
    !v ||
    v.format !== 'shantu-layout-draft' ||
    v.version !== 1 ||
    !number(v.viewport?.width, 266, 1600) ||
    !number(v.viewport?.height, 400, 1600) ||
    !Array.isArray(v.entries) ||
    v.entries.length > 256
  )
    throw Error('布局格式或画布尺寸无效');
  const seen = new Set();
  for (const e of v.entries) {
    if (
      !e ||
      typeof e.selector !== 'string' ||
      !e.selector ||
      e.selector.length > 600 ||
      /[{};<@]/.test(e.selector) ||
      seen.has(e.selector) ||
      typeof e.label !== 'string' ||
      e.label.length > 120 ||
      !number(e.dx, -3000, 3000) ||
      !number(e.dy, -3000, 3000) ||
      !number(e.scale, 0.4, 2.5) ||
      (e.width !== null && !number(e.width, 16, 2000)) ||
      (e.height !== null && !number(e.height, 16, 2000)) ||
      (e.fontSize !== null && !number(e.fontSize, 8, 40)) ||
      typeof e.hidden !== 'boolean'
    )
      throw Error('布局控件参数无效');
    seen.add(e.selector);
  }
  return {
    format: v.format,
    version: 1,
    viewport: { width: v.viewport.width, height: v.viewport.height },
    entries: v.entries.map((e) => ({
      selector: e.selector,
      label: e.label,
      dx: e.dx,
      dy: e.dy,
      width: e.width,
      height: e.height,
      scale: e.scale,
      fontSize: e.fontSize,
      hidden: e.hidden,
    })),
  };
}
export function layoutCss(layout) {
  return validateLayout(layout)
    .entries.map(
      (e) =>
        `${e.selector}{translate:${e.dx}px ${e.dy}px!important;scale:${e.scale}!important;transform-origin:top left!important;${e.width === null ? '' : `width:${e.width}px!important;min-width:0!important;max-width:none!important;box-sizing:border-box!important;`}${e.height === null ? '' : `height:${e.height}px!important;min-height:0!important;max-height:none!important;box-sizing:border-box!important;`}${e.fontSize === null ? '' : `font-size:${e.fontSize}px!important;`}${e.hidden ? 'display:none!important;' : ''}}${e.fontSize === null ? '' : `\n${e.selector} :is(small,span,label,strong,p,input,button,select,text){font-size:${e.fontSize}px!important;}`}`,
    )
    .join('\n');
}
