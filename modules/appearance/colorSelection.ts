export function normalizeHexColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  return /^[a-f\d]{6}$/i.test(hex) ? `#${hex.toLowerCase()}` : null;
}

export function hexToHsv(hex: string) {
  const value = normalizeHexColor(hex) ?? '#ffffff';
  const [r, g, b] = [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
  const h = !delta ? 0 : max === r ? ((g - b) / delta + 6) % 6
    : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return { h: h * 60, s: max ? delta / max : 0, v: max };
}

export function hsvToHex(h: number, s: number, v: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s)); v = Math.max(0, Math.min(1, v));
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const rgb = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + rgb.map(n => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('');
}

/** Use the native setter so React observes a genuine input change on controlled fields. */
export function applyInputColor(input: HTMLInputElement, value: string): boolean {
  const color = normalizeHexColor(value);
  if (!color || !input.isConnected || input.type !== 'color' || input.disabled || input.readOnly) return false;
  const view = input.ownerDocument.defaultView;
  if (!view) return false;
  const setter = Object.getOwnPropertyDescriptor(view.HTMLInputElement.prototype, 'value')?.set;
  if (!setter) return false;
  setter.call(input, color);
  input.dispatchEvent(new view.Event('input', { bubbles: true }));
  input.dispatchEvent(new view.Event('change', { bubbles: true }));
  return true;
}
