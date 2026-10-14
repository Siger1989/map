import { Navigation, X, RefreshCw, LocateFixed, ChevronDown, ChevronUp, ArrowLeft, ArrowUp, CornerUpLeft, CornerUpRight, Undo2, Flag, Map as MapIcon, PersonStanding } from 'lucide-react';
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
  const showCompactInstruction = !g.error && !s.quality && !s.offRoute && !s.arrived && !s.departurePending && !!g.instruction;
  const [maneuverDistance, maneuverUnit] = (g.instruction ? formatDistance(g.instruction.distance) : '').split(' ');
  const compactState = g.error || s.quality || (s.offRoute || s.arrived || s.departurePending ? status : '');
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
  const kind = s.arrived ? 'arrival' : showCompactInstruction ? maneuverKind(g.instruction?.text ?? '') : 'unknown';
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
          </strong> : <button className="guidance-resume" aria-label="继续导航" aria-pressed={following} onClick={onFollow}>
            <Navigation size={15} />
            <span>{following
              ? `${TRAVEL_MODES.find(m => m.id === s.route.mode)?.label}导航`
              : '继续导航'}</span>
          </button>}
          <div className="guidance-header-actions">
            {onFirstPerson && <button className="guidance-first-person" aria-label="第一人称模式"
              aria-pressed={cameraMode === 'forward'} data-waiting={cameraWaiting}
              title={cameraMode === 'forward' ? '第一人称已开启 · 点击切换俯视' : '开启近距离第一人称'}
              onClick={onFirstPerson}><PersonStanding size={19} /><span>{cameraMode === 'forward' ? cameraWaiting ? '等待' : '近景' : '俯视'}</span></button>}
            {displayPanel ? <button aria-label="返回导航详情" title="返回导航详情" onClick={onCloseDisplay}><ArrowLeft size={18} /></button> : compact && <button className="guidance-expand" aria-label={expanded ? '收起导航详情' : '展开导航详情'} title={expanded ? '收起导航详情' : '展开导航详情'} aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</button>}
            <button onClick={onStop} aria-label="结束导航" title="结束导航">
              <X size={18} />
            </button>
          </div>
        </div>
        {compact && !expanded && !displayPanel && forwardNavigation && <div className="guidance-compact-primary" data-maneuver={kind}>
          <span className="guidance-maneuver-icon" aria-hidden="true"><ManeuverIcon size={38} strokeWidth={2.4} /></span>
          <div className="guidance-maneuver-copy">
            {showCompactInstruction ? <>
              <span className="guidance-maneuver-distance">{maneuverDistance}<small> {maneuverUnit}</small></span>
              <span className="guidance-maneuver-text" title={g.instruction!.text}>{g.instruction!.text}</span>
            </> : <span className="guidance-compact-state" role="status" title={compactState || status}>{compactState || status}</span>}
          </div>
        </div>}
        {positionStatus && !displayPanel && (forwardNavigation || expanded) && <span className="guidance-inline-status" role="status" data-position-assessment={effectivePositionAssessment?.kind}>{positionStatus}</span>}
        {positionStatus && allowDirectionReference && !displayPanel && expanded && <span className="guidance-inline-status" role="note">黄色仅作接回方向参考</span>}
        {viewNotice && !positionStatus && !displayPanel && (forwardNavigation || expanded) && <span className="guidance-inline-status" role="status">{viewNotice}</span>}
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
