/** Resolve retained preview scenes without enabling retired query-driven features. */
export function phonePreviewRoute(params) {
  const scene = params.get('scene');
  if (scene === 'journey') {
    const route = params.get('route');
    return {
      scenePreview: true,
      title: '山兔 · 第三人称行程模拟',
      page: '/journey-preview.html' + (route === 'road' || route === 'winding' ? '?route=' + route : ''),
    };
  }
  if (scene === 'sky') return {
    scenePreview: true, title: '山兔 · 青城山日月观景',
    page: '/sky-preview.html' + (params.has('night') ? '?night=1' : ''),
  };
  if (scene === 'marker') return {
    scenePreview: true, title: '山兔 · 标记点观景', page: '/sky-preview.html?marker=1',
  };
  if (scene === 'floating-nav') return {
    scenePreview: true, title: '山兔 · 悬浮窗口布局', page: '/floating-navigation-preview.html',
  };
  return { scenePreview: false, title: null, page: '/' };
}
