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
      (e.zIndex != null && !number(e.zIndex, -1000, 99999)) ||
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
      ...(e.zIndex == null ? {} : { zIndex: Math.round(e.zIndex) }),
    })),
  };
}
export function layoutCss(layout) {
  return validateLayout(layout)
    .entries.map((e) => {
      // Preview overrides must beat the app's density rules, including their !important sizes.
      const selector = `:is(#shantu-layout-priority#shantu-layout-priority,:root) ${e.selector}`;
      const declarations = [];
      // Do not create a containing block merely because the user changed a font or z-index.
      if (e.dx || e.dy)
        declarations.push(`translate:${e.dx}px ${e.dy}px!important`);
      if (e.scale !== 1)
        declarations.push(
          `scale:${e.scale}!important`,
          'transform-origin:top left!important',
        );
      for (const dimension of ['width', 'height'])
        if (e[dimension] !== null)
          declarations.push(
            `${dimension}:${e[dimension]}px!important`,
            `min-${dimension}:0!important`,
            `max-${dimension}:none!important`,
            'box-sizing:border-box!important',
          );
      if (e.fontSize !== null)
        declarations.push(`font-size:${e.fontSize}px!important`);
      if (e.zIndex != null) declarations.push(`z-index:${e.zIndex}!important`);
      if (e.hidden) declarations.push('display:none!important');
      return (
        `${selector}{${declarations.join(';')}}` +
        (e.fontSize === null
          ? ''
          : `\n${selector} :is(small,span,label,strong,p,input,button,select,text){font-size:${e.fontSize}px!important;}`)
      );
    })
    .join('\n');
}
