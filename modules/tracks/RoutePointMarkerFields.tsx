import { useState } from 'react';
import { MARKER_ICONS, markerSolidPath, type MarkerIconId } from '../annotations/icons';
export type PointMarkerInput = {name:string;note:string;color:string;icon:MarkerIconId};
export function RoutePointMarkerFields({ initial, onAdd, onBack }: {
  initial: {color?:string;note?:string}; onAdd:(value:PointMarkerInput)=>boolean; onBack:()=>void;
}) {
  const [value,setValue]=useState<PointMarkerInput>({name:'',note:initial.note?.slice(0,500) ?? '',color:initial.color ?? '#23bd7e',icon:'pin'});
  const [choosingIcon,setChoosingIcon]=useState(false);
  const iconImage=(id:MarkerIconId)=><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="currentColor"><path d={markerSolidPath(id)} fillRule="evenodd"/></svg>;
  if(choosingIcon)return <div className="route-point-marker-fields" aria-label="选择标记图案">
    <strong>选择图案 · {MARKER_ICONS[value.icon].name}</strong>
    <div className="route-point-icon-grid"><button aria-label="返回标记信息" onClick={()=>setChoosingIcon(false)}>返回</button>{Object.entries(MARKER_ICONS).map(([id,icon])=><button key={id} title={icon.name} aria-label={icon.name} aria-pressed={value.icon===id} onClick={()=>{setValue({...value,icon:id as MarkerIconId});setChoosingIcon(false);}}>{iconImage(id as MarkerIconId)}</button>)}</div>
  </div>;
  return <div className="route-point-marker-fields" aria-label="在所选点添加标记">
    <strong>在所选点添加标记</strong>
    <div><button className="route-point-icon-button" aria-label={`选择标记图案：${MARKER_ICONS[value.icon].name}`} title={MARKER_ICONS[value.icon].name} onClick={()=>setChoosingIcon(true)}>{iconImage(value.icon)}</button>
      <input aria-label="标记名称" maxLength={60} placeholder="标记名称" value={value.name} onChange={e=>setValue({...value,name:e.target.value})}/>
      <input aria-label="标记颜色" type="color" value={value.color} onChange={e=>setValue({...value,color:e.target.value})}/></div>
    <input aria-label="标记备注" maxLength={500} placeholder="备注（可不填）" value={value.note} onChange={e=>setValue({...value,note:e.target.value})}/>
    <div><button onClick={onBack}>返回选点</button><button onClick={()=>{if(onAdd({...value,name:value.name.trim() || MARKER_ICONS[value.icon].name}))onBack();}}>添加标记</button></div>
    <small>随路线一起保存；保存前可撤销。</small>
  </div>;
}
