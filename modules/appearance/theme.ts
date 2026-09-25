export const THEME_KEY = 'shantu.appearance.v1';
export type Palette = { accent: string; background: string; button: string; foreground: string; contrast: number };
export type Appearance = { mode: 'light' | 'dark' | 'system'; light: Palette; dark: Palette };
export const DEFAULT_APPEARANCE: Appearance = {
  mode: 'dark',
  light: { accent: '#15572b', background: '#ffffff', button: '#eef3f0', foreground: '#10243c', contrast: 40 },
  dark: { accent: '#d0f76b', background: '#18201f', button: '#252e2b', foreground: '#f2f5ed', contrast: 40 },
};
export const PRESETS = [
  { name: '山兔默认', light: DEFAULT_APPEARANCE.light, dark: DEFAULT_APPEARANCE.dark },
  { name: '湖蓝', light: { accent: '#176ba0', background: '#f5faff', button: '#e3edf7', foreground: '#18364a', contrast: 40 }, dark: { accent: '#7cc7ff', background: '#142431', button: '#2c4053', foreground: '#eaf5ff', contrast: 50 } },
  { name: '暖沙', light: { accent: '#875820', background: '#fff9ef', button: '#f0e6d7', foreground: '#3c3022', contrast: 40 }, dark: { accent: '#edc28a', background: '#292219', button: '#493b2c', foreground: '#fff4e1', contrast: 50 } },
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
  const active = mix(button,p.accent,.16);
  return {
    '--ui-surface': p.background, '--ui-ink': ink, '--ui-accent': p.accent,
    '--ui-active': active, '--ui-active-ink': contrastRatio(active,p.accent) >= 4.5 ? p.accent : buttonInk,
    '--ui-button': button, '--ui-button-ink': buttonInk,
    '--ui-raised': button, '--ui-field': mix(button,ink,.055),
    '--ui-selected': mix(p.background,p.accent,.11),
    '--ui-danger': luminance(p.background) < .2 ? '#ff9b8f' : '#a33626',
    '--ui-line': mix(p.background,ink,.06+p.contrast/1000),
    '--ui-muted': mix(ink,p.background,.25),
    '--ui-on-accent': contrastRatio(p.accent,'#ffffff') >= contrastRatio(p.accent,'#10243c') ? '#ffffff' : '#10243c',
  };
}
