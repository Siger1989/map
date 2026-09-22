import { useState } from 'react';
import { useAppearance } from './AppearanceProvider';
import { contrastRatio, DEFAULT_APPEARANCE, PRESETS, type Appearance, type Palette } from './theme';
function ColorField({name,value,onChange}: {name:string;value:string;onChange:(value:string)=>void}) {
  const [draft,setDraft] = useState<string|null>(null);
  const invalid = draft !== null && !/^#[\da-f]{6}$/i.test(draft);
  return <label className="appearance-color"><span>{name}</span>
    <input type="color" aria-label={`${name}选择器`} value={value} onChange={e=>{setDraft(null);onChange(e.target.value);}}/>
    <input aria-label={`${name}色值`} aria-invalid={invalid} value={draft ?? value} maxLength={7} spellCheck={false} onBlur={()=>setDraft(null)} onChange={e=>{setDraft(e.target.value);if(/^#[\da-f]{6}$/i.test(e.target.value))onChange(e.target.value);}}/>
  </label>;
}
export function AppearanceSettings({onBack}: {onBack:()=>void}) {
  const {settings,dark,save,message} = useAppearance(), scheme = dark ? 'dark' : 'light', palette = settings[scheme];
  const update = (patch: Partial<Palette>) => save({...settings,[scheme]:{...palette,...patch}});
  return <section className="appearance-settings" aria-label="个性化配色">
    <header><button onClick={onBack}>返回</button><strong>个性化</strong><button onClick={()=>save(structuredClone(DEFAULT_APPEARANCE))}>恢复默认</button></header>
    <label className="appearance-mode">外观<select aria-label="外观模式" value={settings.mode} onChange={e=>save({...settings,mode:e.target.value as Appearance['mode']})}><option value="light">浅色</option><option value="dark">深色</option><option value="system">跟随系统</option></select></label>
    <div className="appearance-presets" aria-label="配色风格">{PRESETS.map(p=><button key={p.name} aria-pressed={JSON.stringify(p[scheme])===JSON.stringify(palette)} onClick={()=>save({mode:settings.mode,light:{...p.light},dark:{...p.dark}})}><i style={{background:p[scheme].accent}}/>{p.name}</button>)}</div>
    <div className="appearance-preview" aria-label="配色即时预览"><strong>{dark?'深色':'浅色'}预览</strong><span>窗口文字</span><span className="appearance-sample">选中按钮</span></div>
    {(['accent','background','button','foreground'] as const).map((key,i)=><ColorField key={`${scheme}-${key}`} name={['主色','窗口背景','按钮底色','文字'][i]} value={palette[key] ?? DEFAULT_APPEARANCE[scheme][key]} onChange={value=>update({[key]:value})}/>)}
    <label className="appearance-contrast">对比度 {palette.contrast}<input type="range" aria-label="界面对比度" min="0" max="100" value={palette.contrast} onChange={e=>update({contrast:Number(e.target.value)})}/></label>
    {contrastRatio(palette.background,palette.foreground)<4.5 && <p role="status">文字与背景太接近，已自动使用清晰的文字色。</p>}
    <small role="status">{message || '调整立即预览并保存，可随时恢复山兔默认。'}</small>
  </section>;
}
