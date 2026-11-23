import { ChevronDown } from 'lucide-react';
import type { MoonGuide } from './moonGuideGeometry';
import { constellationOptions } from './constellations';

interface Props {
  guide:MoonGuide; id:string; label:string; following:boolean; searching:boolean; cameraLive:boolean;
  showStars:boolean; showGalaxy:boolean; faint:boolean;
  onSelect(id:string):void; onFind():void; onStars():void; onGalaxy():void;
}

export function SkyTargetControls(p:Props) {
  return <div className="sky-target-controls">
    <div className="sky-target-row">
      <label>
        目标
        <span className="sky-target-picker">
          <span className="sky-target-value" aria-hidden="true">{p.label}</span>
          <ChevronDown size={13} aria-hidden="true" />
          <select aria-label="观景目标" value={p.id} onChange={e=>p.onSelect(e.target.value)}>
            <option value="sun">太阳</option>
            <option value="moon">月亮</option>
            <option value="milky-way">银河中心</option>
            <optgroup label="星座">{constellationOptions.map(star=><option key={star.id} value={star.id}>{star.name}</option>)}</optgroup>
          </select>
        </span>
      </label>
      <button type="button" onClick={p.onFind} disabled={p.searching}>{p.searching?'查找中…':p.following&&!p.cameraLive?'解除跟踪':'找'+p.label}</button>
      <button type="button" aria-pressed={p.showStars} onClick={p.onStars}>星座</button>
      <button type="button" aria-pressed={p.showGalaxy} onClick={p.onGalaxy}>银河</button>
    </div>
    <small className="sky-target-note">{p.guide.message}{p.faint?' · 天光较亮':''}</small>
  </div>;
}

export function SkyTargetMarker({ guide,label }: { guide: MoonGuide;label:string }) {
  if (!guide.point || guide.state !== 'visible') return null;
  const { x, y } = guide.point;
  return <span aria-hidden="true" style={{
    position: 'absolute', left: x, top: y, width: 22, height: 22, borderRadius: '50%',
    transform: 'translate(-50%, -50%)', border: '1px solid #e2efff', pointerEvents: 'none',
    boxShadow: '0 0 0 1px #142331, inset 0 0 0 1px #142331',
  }}>
    <span style={{
      position: 'absolute', left: '50%', top: 23, transform: 'translateX(-50%)', whiteSpace: 'nowrap',
      color: '#f1f7ff', padding: '2px 5px', borderRadius: 4, fontSize: 11,
      lineHeight: 1.2, background: '#142331e8',
    }}>{label}</span>
  </span>;
}
