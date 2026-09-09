type Recipe = { candidate: string; inner: string; className: string };

/** Bounded APK-only layout fallback; native querySelector/matches stay intact. */
export function installRelationalLayout() {
  if (CSS.supports('selector(:has(*))')) return;
  const collected = new Map<string, Recipe>();
  const visit = (rules: CSSRuleList) => {
    for (const rule of rules) {
      const style = (rule as CSSStyleRule).style;
      if (style)
        for (let index = 0; index < style.length; index++) {
          const name = style.item(index);
          if (!name.startsWith('--shantu-has-')) continue;
          const hex = style.getPropertyValue(name).trim();
          const text = new TextDecoder().decode(
            Uint8Array.from(hex.match(/../g) ?? [], (byte) =>
              parseInt(byte, 16),
            ),
          );
          collected.set(name, {
            ...JSON.parse(text),
            className: name.slice(2),
          });
        }
      if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules);
    }
  };
  // Old Chromium does not enumerate custom properties on getComputedStyle.
  // Read only the app's same-origin, already-loaded stylesheet declarations.
  for (const sheet of document.styleSheets) {
    if (!sheet.href || new URL(sheet.href).origin === location.origin)
      visit(sheet.cssRules);
  }
  const recipes = [...collected.values()];
  document.documentElement.dataset.layoutRules = String(recipes.length);
  let pending = 0;
  const refresh = () => {
    pending = 0;
    for (const recipe of recipes) {
      const active = new Set(document.querySelectorAll(`.${recipe.className}`));
      for (const element of document.querySelectorAll(recipe.candidate)) {
        const matched = Boolean(element.querySelector(recipe.inner));
        if (element.classList.contains(recipe.className) !== matched)
          element.classList.toggle(recipe.className, matched);
        active.delete(element);
      }
      for (const element of active) element.classList.remove(recipe.className);
    }
  };
  const schedule = () => {
    if (!pending) pending = requestAnimationFrame(refresh);
  };
  refresh();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      'class',
      'disabled',
      'data-panel',
      'data-view',
      'data-typing',
      'data-active',
    ],
  });
  document.addEventListener('change', schedule, true);
  document.addEventListener('input', schedule, true);
}
