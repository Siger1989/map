import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, Layers, X } from 'lucide-react';
import './rasterLevel.css';
export function RasterLevelControl({ name, level, minLevel = 1, maxLevel, availableLevel, onLevel, onSources, opacity, onOpacity }: {
  name: string; level: number | null; minLevel?: number; maxLevel: number; availableLevel: number;
  onLevel: (level: number | null) => void; onSources: () => void;
  opacity: number; onOpacity: (value: number) => void;
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
      <label>细节锁定<select aria-label="影像细节锁定" value={level ?? 'auto'} onChange={e => onLevel(e.target.value === 'auto' ? null : Number(e.target.value))}><option value="auto">自动</option>{Array.from({ length: Math.max(0, maxLevel - minLevel + 1) }, (_,i) => i + minLevel).reverse().map(z => <option key={z} value={z} >固定 {z} 级</option>)}</select></label>
      <label>道路/注记 {Math.round(opacity * 100)}%<input aria-label="道路与注记不透明度" type="range" min="0" max="1" step="0.05" value={opacity} onChange={e => onOpacity(Number(e.target.value))}/></label>
      <small>{maxLevel ? '优先全屏固定级别；范围过大时中心高清、外围同源概览。自由缩放，停下拖动后更新。' : '此图源没有可切换的影像层级。'}</small>
      {level!==null && detailStatus && <small role="status">{detailStatus}</small>}
      <button onClick={() => { setOpen(false); onSources(); }}>选择图源</button>
    </section>}
  </div>;
}
