// One bounded token protocol for the actual App and the preview editor.
import { MATERIAL_DIMENSIONS } from './materialDimensions.js';
export const MATERIAL_SCHEMA = 'shantu.material.v1';
export const MATERIAL_TOKEN_NAMES = Object.freeze([
  'glass-surface','material-panel','material-favorites','material-topbar','material-bottom',
  'material-rail','material-toast','button','raised','control-subtle','close','field',
  'selected','active','accent','on-accent','ink','glass-ink','button-ink','muted','glass-muted',
  'line','glass-line','glass-border','switch-on','switch-off','on-switch','on-switch-off',
  'glass-filter','glass-shadow','radius-card','radius-control','glass-edge-width',
  'selected-ink','active-ink','input-radius',
].map(name => `--ui-${name}`).concat(MATERIAL_DIMENSIONS.map(item=>item.token)));
const allowed = new Set(MATERIAL_TOKEN_NAMES);
export function validateMaterial(payload) {
  if (!payload || payload.schema !== MATERIAL_SCHEMA || !Number.isSafeInteger(payload.revision) || payload.revision < 0)
    throw new Error('材质协议或版本无效');
  if (!payload.tokens || typeof payload.tokens !== 'object' || Array.isArray(payload.tokens)) throw new Error('材质参数无效');
  const entries = Object.entries(payload.tokens);
  if (entries.length > MATERIAL_TOKEN_NAMES.length) throw new Error('材质参数过多');
  for (const [name, value] of entries) {
    if (!allowed.has(name) || typeof value !== 'string' || value.length > 180 || !value.trim() || /[;{}<>!\\]|url\s*\(|expression\s*\(|@/i.test(value))
      throw new Error('材质参数不在允许范围');
    const dimension=MATERIAL_DIMENSIONS.find(item=>item.token===name);
    if(dimension&&(!/^\d+(?:\.\d+)?px$/.test(value)||parseFloat(value)<dimension.min||parseFloat(value)>dimension.max))throw new Error('尺寸超出允许范围');
  }
  return { schema: MATERIAL_SCHEMA, revision: payload.revision, tokens: Object.fromEntries(entries) };
}

/** Temporary overrides only. User appearance, saved presets and business data are untouched. */
export function installMaterialRuntime(win) {
  const doc = win.document;
  let revision = 0, tokens = {};
  const style = doc.createElement('style');
  style.dataset.nativeMaterialPreview = 'true';
  doc.head.append(style);
  const read = () => {
    const computed = win.getComputedStyle(doc.documentElement);
    return { schema: MATERIAL_SCHEMA, revision, tokens: Object.fromEntries(MATERIAL_TOKEN_NAMES.map(name => [name, computed.getPropertyValue(name).trim()]).filter(([, value]) => value)) };
  };
  const api = {
    read,
    apply(payload) {
      const next = validateMaterial(payload);
      if (next.revision <= revision) throw new Error('调色版本已过期，请重新读取App参数');
      for (const [name, value] of Object.entries(next.tokens)) {
        const property = MATERIAL_DIMENSIONS.some(item=>item.token===name) ? 'width' : name.includes('radius') ? 'border-radius' : name === '--ui-glass-filter' ? 'backdrop-filter' : name === '--ui-glass-shadow' ? 'box-shadow' : name === '--ui-glass-edge-width' ? 'border-width' : 'color';
        if (!win.CSS.supports(property, value)) throw new Error('材质属性值无效');
      }
      tokens = { ...tokens, ...next.tokens };
      style.textContent = `:root{${Object.entries(tokens).map(([key,value]) => `${key}:${value}!important`).join(';')}}`;
      revision = next.revision;
      win.dispatchEvent(new win.Event('shantu-material-change'));
      return read();
    },
    restore() { style.textContent = ''; tokens = {}; revision++; win.dispatchEvent(new win.Event('shantu-material-change')); return read(); },
  };
  win.__shantuMaterialRuntime = api;
  return () => { style.remove(); if (win.__shantuMaterialRuntime === api) delete win.__shantuMaterialRuntime; };
}
