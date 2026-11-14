/** APK viewport units and standard backdrop filters survive production lowering. */
export default function mobileViewportCompatibility() {
  return {
    postcssPlugin: 'shantu-mobile-viewport',
    OnceExit(root) {
      // LightningCSS treats the vendor spelling as an alias and keeps the last
      // declaration. If -webkit comes last it can discard the standard property
      // even for a Chrome target; current Android WebView then computes no blur.
      // Preserve intentionally different fallback values/priority. Normalize only
      // an equivalent pair, or add the standard spelling to a vendor-only rule.
      root.walkRules(rule => {
        const declarations = rule.nodes.filter(node => node.type === 'decl');
        const prefixed = declarations.filter(node => node.prop === '-webkit-backdrop-filter').at(-1);
        if (!prefixed) return;
        const standard = declarations.filter(node => node.prop === 'backdrop-filter').at(-1);
        if (!standard) { prefixed.cloneAfter({ prop: 'backdrop-filter' }); return; }
        if (standard.value.trim() !== prefixed.value.trim() || !!standard.important !== !!prefixed.important) return;
        if (rule.index(standard) < rule.index(prefixed)) {
          standard.remove();
          rule.insertAfter(prefixed, standard);
        }
      });
    },
    Declaration(declaration) {
      if (!/\d(?:\.\d+)?dvh\b/.test(declaration.value)) return;
      declaration.value = declaration.value.replace(
        /(\d+(?:\.\d+)?)dvh\b/g,
        (_, value) => `calc(var(--shantu-vh, 1vh) * ${value})`,
      );
    },
  };
}
