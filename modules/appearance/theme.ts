export const THEME_KEY = 'shantu.appearance.v1';
export type Palette = { accent: string; background: string; button: string; foreground: string; contrast: number };
export type Appearance = { mode: 'light' | 'dark' | 'system'; light: Palette; dark: Palette };
export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'light',
  light: { accent: '#f4a900', background: '#fffaf1', button: '#fff0d8', foreground: '#49311f', contrast: 45 },
  dark: { accent: '#d0f76b', background: '#18201f', button: '#252e2b', foreground: '#f2f5ed', contrast: 40 },
};
export const PRESETS = [
  { name: '山兔默认', light: { accent: '#15572b', background: '#ffffff', button: '#eef3f0', foreground: '#10243c', contrast: 40 }, dark: DEFAULT_APPEARANCE.dark },
  { name: '奶油橙', light: { accent: '#f4a900', background: '#fffaf1', button: '#fff0d8', foreground: '#49311f', contrast: 45 }, dark: { accent: '#ffc45e', background: '#2b2119', button: '#493628', foreground: '#fff3df', contrast: 50 } },
  { name: '科技深蓝', light: { accent: '#006b8c', background: '#f2f8fc', button: '#dfedf5', foreground: '#132b43', contrast: 55 }, dark: { accent: '#68dcff', background: '#101e30', button: '#1d344c', foreground: '#edf6ff', contrast: 55 } },
  { name: '湖蓝', light: { accent: '#176ba0', background: '#f5faff', button: '#e3edf7', foreground: '#18364a', contrast: 40 }, dark: { accent: '#7cc7ff', background: '#142431', button: '#2c4053', foreground: '#eaf5ff', contrast: 50 } },
  { name: '暖沙', light: { accent: '#875820', background: '#fff9ef', button: '#f0e6d7', foreground: '#3c3022', contrast: 40 }, dark: { accent: '#edc28a', background: '#292219', button: '#493b2c', foreground: '#fff4e1', contrast: 50 } },
  // New comparison set: adaptations of established design-system principles, not copied official themes.
  { name: '海盐蓝', light: { accent: '#1769aa', background: '#f5faff', button: '#e5f0fa', foreground: '#162e46', contrast: 45 }, dark: { accent: '#81c9ff', background: '#142332', button: '#20394c', foreground: '#edf7ff', contrast: 50 } },
  { name: '薄荷绿', light: { accent: '#16856e', background: '#f3fbf7', button: '#ddf2e8', foreground: '#183b32', contrast: 45 }, dark: { accent: '#79d9b6', background: '#122b26', button: '#1e4036', foreground: '#ecfaf3', contrast: 50 } },
  { name: '雾紫', light: { accent: '#7155a5', background: '#f8f5fc', button: '#ece5f6', foreground: '#302746', contrast: 45 }, dark: { accent: '#c2a5ff', background: '#241c32', button: '#3a2d4d', foreground: '#f8f2ff', contrast: 50 } },
  { name: '珊瑚', light: { accent: '#b9443c', background: '#fff6f2', button: '#ffe4dc', foreground: '#4a2826', contrast: 45 }, dark: { accent: '#ff9a83', background: '#311e1c', button: '#4b2d28', foreground: '#fff0eb', contrast: 50 } },
  { name: '深琥珀', light: { accent: '#8f5700', background: '#fff8e8', button: '#f4e6c6', foreground: '#3f2b17', contrast: 45 }, dark: { accent: '#ffcb66', background: '#241c13', button: '#41311f', foreground: '#fff5e1', contrast: 50 } },
] satisfies { name: string; light: Palette; dark: Palette }[];
const hex = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value);
export function parseAppearance(raw: string | null): Appearance {
  try {
    const value = JSON.parse(raw ?? 'null');
    const valid = (p: Palette) => p && hex(p.accent) && hex(p.background) && hex(p.foreground) && Number.isFinite(p.contrast) && p.contrast >= 0 && p.contrast <= 100;
    if (['light','dark','system'].includes(value?.mode) && valid(value.light) && valid(value.dark)) {
      return {...value,light:{...value.light,button:hex(value.light.button)?value.light.button:DEFAULT_APPEARANCE.light.button},dark:{...value.dark,button:hex(value.dark.button)?value.dark.button:DEFAULT_APPEARANCE.dark.button}};
    }
  } catch { /* A corrupt preference must never prevent the map from opening. */ }
  return structuredClone(DEFAULT_APPEARANCE);
}
const rgb = (color: string) => [1,3,5].map(i => parseInt(color.slice(i,i+2),16));
export function mix(a: string, b: string, amount: number) {
  const left = rgb(a), right = rgb(b);
  return '#' + left.map((v,i) => Math.round(v*(1-amount)+right[i]*amount).toString(16).padStart(2,'0')).join('');
}
function luminance(color: string) {
  return rgb(color).map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4).reduce((n,v,i) => n+v*[.2126,.7152,.0722][i],0);
}
export function contrastRatio(a: string, b: string) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function themeTokens(p: Palette) {
  // Keep controls readable even if the chosen text/accent nearly matches the background.
  const safeInk = contrastRatio(p.background,'#10243c') > contrastRatio(p.background,'#ffffff') ? '#10243c' : '#ffffff';
  const ink = contrastRatio(p.background,p.foreground) >= 4.5 ? p.foreground : safeInk;
  const button = p.button ?? DEFAULT_APPEARANCE.light.button;
  const buttonInk = contrastRatio(button,p.foreground) >= 4.5 ? p.foreground : contrastRatio(button,'#10243c') > contrastRatio(button,'#ffffff') ? '#10243c' : '#ffffff';
  const accentInk = contrastRatio(p.background,p.accent) >= 4.5 ? p.accent : ink;
  const active = mix(button,p.accent,.16);
  const selected = mix(p.background,p.accent,.11);
  const selectedInk = contrastRatio(selected,ink) >= 4.5 ? ink : contrastRatio(selected,'#10243c') >= contrastRatio(selected,'#ffffff') ? '#10243c' : '#ffffff';
  const switchOn = mix(p.accent,button,.25);
  const switchOff = mix(p.background,ink,.2);
  const [subtleR,subtleG,subtleB] = rgb(ink);
  const close = luminance(p.background) < .2 ? '#c7b86d' : '#766100';
  const [glassR,glassG,glassB] = rgb(p.background);
  // A thin tint lets the real map supply the material's colour. Strengthen the
  // foreground and raise tint only as needed for bright/dark map backgrounds.
  const glassInk = mix(ink, luminance(p.background) < .2 ? '#ffffff' : '#000000', .18);
  let glassAlpha = .60;
  while (glassAlpha < .9 && ['#000000', '#ffffff'].some(backdrop =>
    contrastRatio(glassInk, mix(backdrop, p.background, glassAlpha)) < 4.5)) {
    glassAlpha = Math.round((glassAlpha + .02) * 100) / 100;
  }
  return {
    '--ui-surface': p.background, '--ui-ink': ink, '--ui-accent': p.accent, '--ui-accent-ink': accentInk,
    '--ui-close': close,
    '--ui-control-subtle': `rgba(${subtleR}, ${subtleG}, ${subtleB}, 0.06)`,
    '--ui-switch-on': switchOn,
    '--ui-on-switch': contrastRatio(switchOn,ink) >= 3 ? ink : contrastRatio(switchOn,'#ffffff') >= contrastRatio(switchOn,'#10243c') ? '#ffffff' : '#10243c',
    '--ui-switch-off': switchOff,
    '--ui-on-switch-off': contrastRatio(switchOff,ink) >= 3 ? ink : contrastRatio(switchOff,'#ffffff') >= contrastRatio(switchOff,'#10243c') ? '#ffffff' : '#10243c',
    '--ui-active': active, '--ui-active-ink': contrastRatio(active,p.accent) >= 4.5 ? p.accent : buttonInk,
    '--ui-button': button, '--ui-button-ink': buttonInk,
    '--ui-raised': button, '--ui-field': mix(button,ink,.055),
    '--ui-selected': selected, '--ui-selected-ink': selectedInk,
    '--ui-danger': luminance(p.background) < .2 ? '#ff9b8f' : '#a33626',
    '--ui-line': mix(p.background,ink,.06+p.contrast/1000),
    '--ui-muted': mix(ink,p.background,.25),
    '--ui-on-accent': contrastRatio(p.accent,'#ffffff') >= contrastRatio(p.accent,'#10243c') ? '#ffffff' : '#10243c',
    '--ui-glass-surface': `rgba(${glassR}, ${glassG}, ${glassB}, ${glassAlpha})`,
    '--ui-glass-ink': glassInk,
    '--ui-glass-muted': glassInk,
    '--ui-glass-filter': 'blur(22px) saturate(125%)',
    '--ui-glass-border': luminance(p.background) < .2 ? 'rgba(255, 255, 255, 0.16)' : 'rgba(255, 255, 255, 0.32)',
    '--ui-glass-line': `rgba(${subtleR}, ${subtleG}, ${subtleB}, 0.14)`,
    '--ui-glass-shadow': '0 8px 24px rgba(0, 0, 0, 0.14)',
  };
}
