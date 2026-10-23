import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, Layers, X } from 'lucide-react';
import './rasterLevel.css';
export function RasterLevelControl({ name, level, minLevel = 1, maxLevel, availableLevel, onLevel, onSources, opacity, onOpacity, quality = 'high', onQuality }: {
  name: string; level: number | null; minLevel?: number; maxLevel: number; availableLevel: number;
  onLevel: (level: number | null) => void; onSources: () => void;
  opacity: number; onOpacity: (value: number) => void;
  quality?: 'standard' | 'high'; onQuality?: (quality: 'standard' | 'high') => void;
}) {
  const [open, setOpen] = useState(false);
  const [detailStatus,setDetailStatus]=useState('');
  useEffect(()=>{const status=(event:Event)=>setDetailStatus((event as CustomEvent<string>).detail);window.addEventListener('shantu-raster-detail',status);return()=>window.removeEventListener('shantu-raster-detail',status);},[]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    document.addEventListener('pointerdown', outside); root.current?.addEventListener('keydown', key);
    const element = root.current;
    return () => { document.removeEventListener('pointerdown', outside); element?.removeEventListener('keydown', key); };
  }, [open]);
  return <div className="raster-level-control" ref={root}>
    <button className="position-dock-button glass" aria-label={`当前图层：${name}，${level === null ? '自动细节' : `细节锁定${level}级`}`} aria-expanded={open} onClick={() => setOpen(!open)}>{level === null ? <Layers size={17}/> : <LockKeyhole size={17}/>}<small>{level === null ? maxLevel ? `约${Math.max(minLevel, availableLevel)}级` : '图层' : `锁${level}级`}</small></button>
    {open && <section className="raster-level-panel" aria-label="当前图层与层级">
      <header><strong title={name}>{name}</strong><button aria-label="关闭图层层级" onClick={() => setOpen(false)}><X size={16}/></button></header>
      <label>影像细节<select aria-label="影像细节锁定" value={level ?? (quality === 'high' ? 'high' : 'auto')} onChange={e => { const value = e.target.value; if (value === 'auto' || value === 'high') { onLevel(null); onQuality?.(value === 'high' ? 'high' : 'standard'); } else onLevel(Number(value)); }}><option value="auto">自动 · 标准</option>{onQuality && maxLevel > 0 && <option value="high">自动 · 高清</option>}{Array.from({ length: Math.max(0, maxLevel - minLevel + 1) }, (_,i) => i + minLevel).reverse().map(z => <option key={z} value={z}>固定 {z} 级</option>)}</select></label>
      <label>道路/注记 {Math.round(opacity * 100)}%<input aria-label="道路与注记不透明度" type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => onOpacity(Number(e.target.value))}/></label>
      <small>{!maxLevel ? '此图源没有可切换的影像层级。' : level !== null ? '固定级别优先；范围过大时中心高清。选择自动可切换画质。' : quality === 'high' ? '同样大小提前加载一级影像，流量与内存占用增加；卡顿可切回标准。' : '画质随缩放自动调整；高清可在同样大小显示更多影像细节。'}</small>
      {level!==null && detailStatus && <small role="status">{detailStatus}</small>}
      <button onClick={() => { setOpen(false); onSources(); }}>选择图源</button>
    </section>}
  </div>;
}
