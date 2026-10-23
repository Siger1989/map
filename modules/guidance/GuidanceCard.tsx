import { Navigation, RefreshCw, LocateFixed, ChevronDown, ChevronUp, ArrowLeft, ArrowUp, CornerUpLeft, CornerUpRight, Undo2, Flag, Map as MapIcon, PersonStanding } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatDistance, TRAVEL_MODES } from '../navigation/types';
import type { GuidanceState } from './useGuidance';
import { maneuverKind } from './maneuverPresentation';
import { freshFix } from './session';
import './guidance.css';

/** Share the rendered height with the adjacent weather rail, including wrapped status text. */
function observeNavigationCard(node: HTMLElement | null) {
  if (!node) return;
  const host = node.closest<HTMLElement>('.observatory.home-map');
  if (!host) return;
  const update = () => host.style.setProperty('--normal-nav-card-height', `${node.getBoundingClientRect().height}px`);
  update();
  const observer = new ResizeObserver(update);
  observer.observe(node);
  return () => { observer.disconnect(); host.style.removeProperty('--normal-nav-card-height'); };
}

export function GuidanceCard({
  guidance: g,
  onStop,
  onFollow,
  onShow,
  following,
  onShare,
  compact = true,
  onFirstPerson,
  onDisplay,
  telemetry,
  compactTelemetry,
  motionNotice,
  displayPanel,
  onCloseDisplay,
  cameraMode = 'top',
  onCameraModeChange,
  viewNotice,
  cameraWaiting = false,
  positionAssessment,
}: {
  guidance: GuidanceState;
  onStop: () => void;
  onFollow: () => void;
  onShow: () => void;
  following: boolean;
  onShare: () => void;
  compact?: boolean;
  onFirstPerson?: () => void;
  onDisplay?: () => void;
  telemetry?: ReactNode;
  compactTelemetry?: ReactNode;
  motionNotice?: string;
  displayPanel?: ReactNode;
  onCloseDisplay?: () => void;
  cameraMode?: 'forward' | 'top';
  onCameraModeChange?: (mode: 'forward' | 'top') => void;
  viewNotice?: string;
  cameraWaiting?: boolean;
  positionAssessment?: { kind: 'uncertain' | 'parallel' | 'away'; message: string };
}) {
  const [expanded, setExpanded] = useState(false);
  const s = g.session;
  if (!s) return null;
  const status = s.departurePending
    ? g.loading
      ? '正在计算当前位置到起点的路线…'
      : g.departureMessage
    : s.departureLength > 0 &&
        s.nextCheckpoint === 0 &&
        !s.quality &&
        !s.offRoute
      ? s.departureReference
        ? '前往路线起点 · 虚线仅作直线参考'
        : '正在前往路线起点'
      : s.arrived
        ? '已到达终点'
        : s.quality ||
          (s.offRoute
            ? g.loading
              ? '正在计算接回路线…'
              : g.rejoin
                ? '沿橙色虚线接回原路线'
                : `已偏离约${formatDistance(s.offset)}`
            : s.offSince !== null
              ? '可能偏离，正在确认…'
              : s.networkSwitched
                ? '已切换相连分叉 · 终点不变'
                : '沿原路线导航');
  const instructionKind = maneuverKind(g.instruction?.text ?? '');
  const instructionCoversRemainingRoute = instructionKind === 'straight' && !!g.instruction &&
    g.remaining > 0 && g.instruction.distance >= g.remaining * 0.8;
  const showCompactInstruction = !g.error && !s.quality && !s.offRoute && !s.arrived && !s.departurePending &&
    !!g.instruction && instructionKind !== 'arrival' && !instructionCoversRemainingRoute;
  const [maneuverDistance, maneuverUnit] = (g.instruction ? formatDistance(g.instruction.distance) : '').split(' ');
  const compactState = g.error || s.quality || (s.offRoute || s.arrived || s.departurePending ? status : '');
  const compactPriorityStatus = compactState;
  const positionIsReliable = !s.offRoute && !s.arrived && !s.quality && !s.departurePending && freshFix(s.last);
  const nearbyRouteOffset = positionIsReliable &&
    s.last && Number.isFinite(s.offset) && s.offset > Math.max(12, s.last.accuracy + 5)
    ? `距规划线约${formatDistance(s.offset)} · 尚未确认偏航` : '';
  const sessionPositionAssessment = s.positionAssessment;
  const effectivePositionAssessment = positionAssessment ?? sessionPositionAssessment;
  const positionStatus = nearbyRouteOffset
    ? effectivePositionAssessment?.message || nearbyRouteOffset
    : '';
  const allowDirectionReference = effectivePositionAssessment?.kind !== 'away' &&
    sessionPositionAssessment?.allowReference !== false;
  const forwardNavigation = cameraMode === 'forward' && !s.arrived && !displayPanel;
  const compactContextStatus = compactPriorityStatus
    ? forwardNavigation ? '' : compactPriorityStatus
    : motionNotice || positionStatus || viewNotice || '';
  const visibleCompactContextStatus = cameraWaiting && compactContextStatus === '等待当前位置…'
    ? motionNotice && !/等待|正在获取/.test(motionNotice) ? motionNotice : ''
    : compactContextStatus;
  const kind = s.arrived ? 'arrival' : showCompactInstruction ? instructionKind : 'unknown';
  const nextCheckpoint = s.checkpoints[s.nextCheckpoint];
  const nextStop = s.route.stops?.[s.nextCheckpoint + 1];
  const destination = s.route.stops?.at(-1)?.name || '终点';
  const nextCheckpointDistance = nextCheckpoint
    ? formatDistance(Math.max(0, nextCheckpoint.distance - s.progress))
    : formatDistance(g.remaining);
  const routeTargetLabel = nextCheckpoint && nextStop && s.nextCheckpoint < s.route.stops!.length - 2
    ? `途经 ${nextStop.name || `点 ${s.nextCheckpoint + 1}`}`
    : destination;
  const ManeuverIcon = kind === 'left' ? CornerUpLeft
    : kind === 'right' ? CornerUpRight
      : kind === 'uturn' ? Undo2
        : kind === 'arrival' ? Flag
          : kind === 'straight' ? ArrowUp : Navigation;
  return (
    <>
    <section
      ref={observeNavigationCard}
      className="guidance-card glass"
      data-compact={compact && !expanded && !displayPanel}
      data-forward-navigation={forwardNavigation}
      data-camera-mode={cameraMode}
      data-content={displayPanel ? 'display' : 'navigation'}
      aria-label="路线导航"
      data-status={
        s.arrived
          ? 'arrived'
          : s.quality
            ? 'waiting'
            : s.offRoute
              ? 'off-route'
              : 'on-route'
      }
    >
      <header>
        <div className="guidance-heading-row">
          {displayPanel || s.arrived ? <strong>
            <Navigation size={17} />
            {displayPanel ? '路线显示' : s.arrived
              ? '导航完成'
              : `导航中 · ${TRAVEL_MODES.find((m) => m.id === s.route.mode)?.label}`}
          </strong> : <button className="guidance-resume guidance-follow-status" aria-label="继续导航" aria-pressed={following} onClick={onFollow}>
            <Navigation size={15} />
            <span className="guidance-follow-label">{cameraWaiting ? '等待定位' : following ? '导航跟随中' : '继续导航'}</span>
            <span className="guidance-mode-tag">{TRAVEL_MODES.find(m => m.id === s.route.mode)?.label}</span>
          </button>}
          <div className="guidance-header-actions">
            {displayPanel ? <button aria-label="返回导航详情" title="返回导航详情" onClick={onCloseDisplay}><ArrowLeft size={18} /></button> : compact && <button className="guidance-expand" aria-label={expanded ? '收起导航详情' : '展开导航详情'} title={expanded ? '收起导航详情' : '展开导航详情'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>}
          </div>
        </div>
        {compact && !expanded && !displayPanel && forwardNavigation && <div className="guidance-compact-primary" data-maneuver={kind}>
          <span className="guidance-maneuver-icon" aria-hidden="true"><ManeuverIcon size={38} strokeWidth={2.4} /></span>
          <div className="guidance-maneuver-copy">
            {showCompactInstruction ? <>
              <span className="guidance-maneuver-distance">{maneuverDistance}<small> {maneuverUnit}</small></span>
              <span className="guidance-maneuver-text" title={g.instruction!.text}>{g.instruction!.text}</span>
            </> : s.arrived || s.departurePending || s.offRoute || s.quality || g.error
              ? <span className="guidance-compact-state" role="status" title={compactState || status}>{compactState || status}</span>
              : <>
                <span className="guidance-maneuver-distance guidance-target-distance">{nextCheckpointDistance}</span>
                <span className="guidance-maneuver-text" title={`沿路线前往${routeTargetLabel}`}>沿路线前往{routeTargetLabel}</span>
              </>}
            {showCompactInstruction && <span className="guidance-remaining-line">全程剩余 {formatDistance(g.remaining)}</span>}
          </div>
        </div>}
        {compact && !expanded && !displayPanel && (compactTelemetry || visibleCompactContextStatus) && <div className="guidance-compact-context">
          {compactTelemetry && <div className="guidance-compact-telemetry">{compactTelemetry}</div>}
          {visibleCompactContextStatus && <span className="guidance-inline-status" role="status" data-position-assessment={effectivePositionAssessment?.kind}>{visibleCompactContextStatus}</span>}
        </div>}
        {motionNotice && !displayPanel && expanded && <span className="guidance-inline-status" role="status" data-position-assessment={effectivePositionAssessment?.kind}>{motionNotice}</span>}
        {positionStatus && !motionNotice && !displayPanel && expanded && <span className="guidance-inline-status" role="status" data-position-assessment={effectivePositionAssessment?.kind}>{positionStatus}</span>}
        {positionStatus && allowDirectionReference && !displayPanel && expanded && <span className="guidance-inline-status" role="note">黄色仅作接回方向参考</span>}
        {viewNotice && !positionStatus && !motionNotice && !displayPanel && expanded && <span className="guidance-inline-status" role="status">{viewNotice}</span>}
      </header>
      {displayPanel ? <div className="guidance-display-content">{displayPanel}</div> : <>
      {(!compact || expanded) && telemetry}
      <div className="guidance-content">
        <p className="guidance-status" role="status">
          {status}
        </p>
        {!s.quality &&
          !s.arrived &&
          (!s.offRoute || g.rejoin) &&
          g.instruction && (
            <p className="guidance-instruction">
              前方 {formatDistance(g.instruction.distance)} ·{' '}
              {g.instruction.text}
            </p>
          )}
        <dl>
          <div>
            <dt>已走约</dt>
            <dd data-testid="guidance-travelled">
              {formatDistance(s.travelled)}
            </dd>
          </div>
          <div>
            <dt>
              {s.departurePending
                ? '主体里程'
                : s.offRoute && !g.rejoin
                  ? '原路线剩余'
                  : '剩余约'}
            </dt>
            <dd data-testid="guidance-remaining">
              {formatDistance(g.remaining)}
            </dd>
          </div>
        </dl>
        {s.nextCheckpoint < s.checkpoints.length && (
          <p className="guidance-note">
            下一途经点 {s.nextCheckpoint + 1} / {s.checkpoints.length}
          </p>
        )}
        {(s.offRoute || s.departurePending) && !g.online && (
          <p className="guidance-error" role="status">
            网络已断开，接回路线需要联网计算。
          </p>
        )}
        {g.error && (
          <p className="guidance-error" role="alert">
            {g.error}
          </p>
        )}
          <div className="guidance-actions">
            {onFirstPerson && <button className="guidance-first-person" aria-label="第一人称模式"
              aria-pressed={cameraMode === 'forward'} data-waiting={cameraWaiting}
              onClick={onFirstPerson}><PersonStanding size={15} />{cameraMode === 'forward' ? cameraWaiting ? '第一人称等待定位' : '第一人称已开启' : '开启第一人称'}</button>}
            {!s.arrived && <button onClick={() => void g.replan()} disabled={g.replanning}>{g.replanning ? '重新规划中…' : '当前位置重规划'}</button>}
            <button onClick={onShare} disabled={s.departurePending}>分享</button>
            {onDisplay && <button aria-label="导航路线显示设置" onClick={() => { setExpanded(true); onDisplay(); }}>路线显示</button>}
            {onCameraModeChange && <button
              className="guidance-camera-mode"
              type="button"
              aria-pressed={cameraMode === 'forward'}
              onClick={() => onCameraModeChange(cameraMode === 'forward' ? 'top' : 'forward')}
            >{cameraMode === 'forward' ? <><MapIcon size={15} />切换俯视</> : <><ArrowUp size={15} />切换前视</>}</button>}
            {!s.arrived && <button onClick={onFollow}>
              <LocateFixed size={16} />
              {following ? '当前位置' : '继续导航'}
            </button>}
            {!s.arrived && (s.offRoute || s.departurePending) && (
              <button
                onClick={g.rejoin ? onShow : g.retry}
                disabled={
                  g.loading || (!s.departurePending && !!s.quality) || !g.online
                }
              >
                {g.rejoin ? (
                  '看接回路线'
                ) : (
                  <>
                    <RefreshCw size={15} />
                    重新计算
                  </>
                )}
              </button>
            )}
            <button type="button" onClick={onStop}>结束导航</button>
          </div>
        {s.gap && (
          <p className="guidance-note">定位中断或精度不足期间未累加距离。</p>
        )}
      </div>
      </>}
    </section>
    </>
  );
}
