import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, CornerUpLeft, CornerUpRight, Undo2, Redo2, Flag, Navigation, LocateFixed, Maximize2, X, Info, MapPin, Route, CircleHelp } from 'lucide-react';
import type { PlannedRoute } from '../navigation/types';
import { formatDistance } from '../navigation/types';
import type { GuidanceState } from '../guidance/useGuidance';
import type { PositionFix } from '../position/types';
import { useNavigationTelemetry } from '../guidance/useNavigationTelemetry';
import { pathOf } from '../guidance/geometry';
import { clockDuration, roadbookNotes, turnKind } from './roadbook';
import { RallyElevation, type NavigationElevationDisplay } from './RallyElevation';
import './rally.css';

const icons = { left: CornerUpLeft, right: CornerUpRight, straight: ArrowUp, 'uturn-left': Undo2, 'uturn-right': Redo2, finish: Flag, unknown: CircleHelp };
export function RallyNavigation({ route, guidance: g, fix, onNormal, onStart, onStop, onLocate, onOverview, display }: {
  route: PlannedRoute; guidance: GuidanceState; fix: PositionFix | null;
  onNormal: () => void; onStart: () => void; onStop: () => void; onLocate: () => void; onOverview: () => void;
  display?: NavigationElevationDisplay;
}) {
  const [help, setHelp] = useState(false);
  const overview = useRef(onOverview);
  overview.current = onOverview;
  useEffect(() => { const frame = requestAnimationFrame(() => overview.current()); return () => cancelAnimationFrame(frame); }, [route.createdAt]);
  const session = g.session;
  const { located, fraction, elapsed, speed, average, remainingSeconds, arrival } = useNavigationTelemetry(route, session, fix);
  const length = useMemo(() => pathOf(route.coordinates).length, [route]);
  const notes = roadbookNotes(route, located ? session!.progress : 0, length);
  const warning = !session ? '路线预览 · 未开始导航' : session.departurePending ? g.departureMessage : session.quality || (session.offRoute ? '已偏离路线，请切回地图查看接回路线' : !located ? '等待新定位' : '');
  const first = located ? { text: g.instruction?.text ?? '沿路线到达终点', distance: g.instruction?.distance ?? g.remaining } : notes[0] ?? { text: '沿路线到达终点', distance: route.distance };
  const currentKind = turnKind(first.text);
  const Icon = icons[currentKind];
  return <div className="rally-workspace" aria-label="拉力路书模式">
    <header className="rally-header"><strong>山兔</strong><h2>拉力路书</h2><button aria-label="路书说明" aria-expanded={help} onClick={() => setHelp(!help)}><Info size={19} /></button><button aria-label="退出拉力模式" onClick={onNormal}><X size={19} /></button></header>
    <nav className="rally-mode" aria-label="导航显示模式"><button onClick={onNormal}>普通导航</button><button aria-pressed="true">拉力路书</button></nav>
    {help && <aside className="rally-help">地图转向提示，非赛事标准路书或实地勘路笔记。绿：直行；橙：转向；紫：掉头；蓝：接入；灰：方向未知。实时速度由连续定位估算；平均速度含停留，定位中断时不显示。剩余时间按路线预估，海拔来自地形模型。<button onClick={() => setHelp(false)}>关闭说明</button></aside>}
    <section className="rally-roadbook" aria-label="连续转向提示">
      <div className="rally-cue" data-kind={currentKind}><div><small>{located ? '当前路段' : '路线预览'}</small><Icon aria-hidden="true" /></div><div className="rally-cue-text"><span className="rally-distance-label">{currentKind === 'finish' ? '距终点' : located ? '前方' : '距起点'}</span><strong>{formatDistance(first.distance)}</strong><h3 data-long={first.text.length > 4} title={first.text}>{first.text}</h3></div></div>
      {[0, 1].map(i => { const n = notes[i + 1]; const access = n?.kind === 'access'; const Next = access ? MapPin : icons[turnKind(n?.text ?? '')]; return <div className="rally-next" data-kind={access ? 'access' : turnKind(n?.text ?? '')} key={i}><small>{i ? '随后' : '接着'}</small>{n && <Next size={40} aria-label={access ? '接入段，方向未核实' : n.text} />}<span title={n?.text}>{access ? '虚线接入 · 方向待核实' : n?.text ?? '后续无更多指令'}</span>{n && <b>{n.distance < 1 ? '同一位置' : <><small>再行</small>{formatDistance(n.distance)}</>}</b>}</div>; })}
      <div className="rally-progress"><span>{fraction === null ? '进度待定位' : `已行 ${formatDistance(session!.progress)}`}</span><span>全程 {formatDistance(route.distance)}</span><progress aria-label="导航进度" max={1} {...(fraction === null ? {} : { value: fraction })} /></div>
    </section>
    <section className="rally-metrics" aria-label="速度与时间"><div className="rally-speeds"><div><span>实时速度 <small>估算</small></span><strong>{speed === null ? '—' : speed.toFixed(1)} <small>km/h</small></strong></div><div><span>平均速度 <small>含停留</small></span><strong>{average === null ? '—' : average.toFixed(1)} <small>km/h</small></strong></div></div><div className="rally-times"><span>已用 {elapsed === null ? '—' : clockDuration(elapsed)}</span><span>还需 {remainingSeconds === null ? '—' : `约${Math.ceil(remainingSeconds / 60)}分`}</span><span>预计 {arrival}</span></div></section>
    <div className="rally-map-caption"><span><MapPin size={14} /> 路口核对</span><button onClick={onOverview}><Route size={15} /> 全程</button><button onClick={onNormal}><Maximize2 size={15} /> 全屏</button></div>
    <div className="rally-map-actions"><button onClick={onLocate}><LocateFixed size={18} />定位</button>{!g.active ? <button onClick={onStart}><Navigation size={18} />开始</button> : <button onClick={onStop}>结束导航</button>}</div>
    {warning && <div className="rally-warning" role="status">{warning}</div>}
    <RallyElevation route={route} fraction={fraction} display={display} />
  </div>;
}
