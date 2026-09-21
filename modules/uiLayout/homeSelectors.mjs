// Keep version-1 layout drafts usable after the homepage skin was isolated.
const aliases = {
  topbar: 'home-topbar',
  'map-actions': 'home-map-actions',
  'position-dock': 'home-position-dock',
  'dock-navigation': 'home-bottom-nav',
  'route-card': 'home-route-card',
  'recording-quick': 'home-recording',
  'recording-chip': 'home-recording',
};
export function homeSelector(selector) {
  // Quoted attribute values are content, not class selectors.
  return selector.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\.([-\w]+)/g,
    (match, quoted, name) => quoted || (aliases[name] ? `.${aliases[name]}` : match));
}
export function migrateHomeLayout(layout, doc) {
  if (!doc.querySelector('.observatory.home-map')) return layout;
  const entries = new Map();
  for (const entry of layout.entries) {
    const selector = homeSelector(entry.selector);
    // If an export contains both generations, the explicit new entry wins.
    if (entries.has(selector) && selector !== entry.selector) continue;
    entries.set(selector, {
      ...entry, selector,
      ...(entry.anchor ? { anchor: { ...entry.anchor, reference: homeSelector(entry.anchor.reference) } } : {}),
    });
  }
  return { ...layout, entries: [...entries.values()] };
}
