/** APK-only viewport lowering; supports custom-property values as well as rules. */
export default function mobileViewportCompatibility() {
  return {
    postcssPlugin: 'shantu-mobile-viewport',
    Declaration(declaration) {
      if (!/\d(?:\.\d+)?dvh\b/.test(declaration.value)) return;
      declaration.value = declaration.value.replace(
        /(\d+(?:\.\d+)?)dvh\b/g,
        (_, value) => `calc(var(--shantu-vh, 1vh) * ${value})`,
      );
    },
  };
}
