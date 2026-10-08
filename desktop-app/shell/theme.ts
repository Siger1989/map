import { parseAppearance, themeTokens, THEME_KEY } from '../../modules/appearance/theme';

function applyTheme() {
  let raw: string | null = null;
  try { raw = localStorage.getItem(THEME_KEY); } catch { /* Storage permission does not block startup. */ }
  const appearance = parseAppearance(raw);
  const dark = appearance.mode === 'dark' || (appearance.mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  for (const [key, value] of Object.entries(themeTokens(dark ? appearance.dark : appearance.light))) {
    document.documentElement.style.setProperty(key, value);
  }
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}
applyTheme();
window.addEventListener('storage', applyTheme);
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
