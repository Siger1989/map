import { useState } from 'react';
import { useAppearance } from './AppearanceProvider';
import { contrastRatio, DEFAULT_APPEARANCE, PALETTE_COLORS, PRESETS, type Appearance, type Palette } from './theme';
import savedMaterialPreset from './savedMaterialPreset.json';
function ColorField({name,value,onChange}: {name:string;value:string;onChange:(value:string)=>void}) {
  const [draft,setDraft] = useState<string|null>(null);
  const invalid = draft !== null && !/^#[\da-f]{6}$/i.test(draft);
  return <label className="appearance-color"><span>{name}</span>
    <input type="color" aria-label={`${name}选择器`} value={value} onChange={e=>{setDraft(null);onChange(e.target.value);}}/>
    <input aria-label={`${name}色值`} aria-invalid={invalid} value={draft ?? value} maxLength={7} spellCheck={false} onBlur={()=>setDraft(null)} onChange={e=>{setDraft(e.target.value);if(/^#[\da-f]{6}$/i.test(e.target.value))onChange(e.target.value);}}/>
  </label>;
}
export function AppearanceSettings() {
  const {settings,dark,save,message,usesSavedMaterial,personalMaterial,applyPersonalMaterial} = useAppearance(), scheme = dark ? 'dark' : 'light', palette = settings[scheme];
  const savedColors = {
    accent: savedMaterialPreset.draft.accent.color,
    background: savedMaterialPreset.draft.panel.color,
    button: savedMaterialPreset.draft.button.color,
    foreground: savedMaterialPreset.draft.ink.color,
  };
  const fieldValue = (key: typeof PALETTE_COLORS[number]) =>
    usesSavedMaterial && !settings.materialColors?.includes(key) ? savedColors[key] : palette[key];
  const update = (patch: Partial<Palette>) =>
    save({...settings,[scheme]:{...palette,...patch}}, PALETTE_COLORS.filter(key => key in patch));
  const applyPalette = (colors: Pick<Appearance, 'light' | 'dark'>) => save({
    ...settings,
    light: { ...settings.light, ...Object.fromEntries(PALETTE_COLORS.map(key => [key, colors.light[key]])) },
    dark: { ...settings.dark, ...Object.fromEntries(PALETTE_COLORS.map(key => [key, colors.dark[key]])) },
  }, PALETTE_COLORS);
  return <section className="appearance-settings" aria-label="个性化配色">
    <label className="appearance-mode">外观<select aria-label="外观模式" value={settings.mode} onChange={e=>save({...settings,mode:e.target.value as Appearance['mode']})}><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></label>
    <div className="appearance-presets" aria-label="配色风格">{PRESETS.map(p=><button key={p.name} aria-pressed={!personalMaterial && PALETTE_COLORS.every(key => p[scheme][key] === palette[key])} onClick={()=>applyPalette(p)}><i style={{background:p[scheme].accent}}/>{p.name}</button>)}<button aria-pressed={personalMaterial} onClick={applyPersonalMaterial}><i style={{background:savedMaterialPreset.tokens['--ui-accent']}}/>我的调色</button></div>
    <div className="appearance-preview" aria-label="配色即时预览"><strong>{dark?'深色':'浅色'}预览</strong><span>窗口文字</span><span className="appearance-sample">选中按钮</span></div>
    {(['accent','background','button','foreground'] as const).map((key,i)=><ColorField key={`${scheme}-${key}`} name={['主色','窗口背景','按钮底色','文字'][i]} value={fieldValue(key)} onChange={value=>update({[key]:value})}/>)}
    <label className="appearance-contrast">对比度 {palette.contrast}<input type="range" aria-label="界面对比度" min="0" max="100" value={palette.contrast} onChange={e=>update({contrast:Number(e.target.value)})}/></label>
    {contrastRatio(fieldValue('background'),fieldValue('foreground'))<4.5 && <p role="status">文字与背景太接近，已自动使用清晰的文字色。</p>}
    <button type="button" onClick={()=>applyPalette(DEFAULT_APPEARANCE)}>恢复默认配色</button>
    <small className="appearance-status" role="status">{message || '配色即时生效，透明度和圆角沿用当前设置。'}</small>
  </section>;
}
