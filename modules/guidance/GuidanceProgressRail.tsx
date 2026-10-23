import { useEffect, useRef, useState } from 'react';
import { formatDistance } from '../navigation/types';
import type { GuidanceSession } from './session';
import { freshFix } from './session';
import './guidanceProgress.css';

/** Read-only route progress for the active navigation session. */
export function GuidanceProgressRail({ session }: { session: GuidanceSession }) {
  const railRef = useRef<HTMLElement>(null);
  const [compact, setCompact] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const update = () => setCompact(rail.clientHeight < 160);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  const total = Math.max(0, session.path.length);
  const progress = Math.min(total, Math.max(0, Number.isFinite(session.progress) ? session.progress : 0));
  const remaining = Math.max(0, total - progress);
  const hasConfirmedFix = !!session.last;
  const located = !session.departurePending && !session.quality && !session.offRoute && freshFix(session.last, now);
  const fraction = total > 0 ? progress / total : 0;
  const status = session.arrived
    ? '已到达终点'
    : session.departurePending
      ? '正在前往路线起点'
      : session.offRoute
        ? '已偏离路线，保留最近确认进度'
        : session.quality
          ? session.quality
          : located
            ? '定位已确认'
            : hasConfirmedFix
              ? '定位已过期，保留最近确认进度'
              : '等待定位';
  const statusLabel = session.arrived
    ? '已到达'
    : session.departurePending
      ? '前往起点'
      : session.offRoute
        ? '偏航'
        : session.quality
          ? session.quality.includes('跳动')
            ? '定位跳动'
            : session.quality.includes('精度')
              ? '精度不足'
              : session.quality.includes('过期')
                ? '定位过期'
                : session.quality.includes('等待当前位置')
                  ? '等待定位'
                  : '定位待确认'
          : located
            ? '定位已确认'
            : hasConfirmedFix
              ? '定位过期'
              : '等待定位';
  const accessibleProgress = hasConfirmedFix
    ? `已确认约${Math.round(fraction * 100)}%`
    : '尚无已确认定位进度';
  const shortDistance = (metres: number) => metres < 1000
    ? `${Math.round(metres)}m`
    : `${(metres / 1000).toFixed(1)}k`;

  return (
    <aside
      ref={railRef}
      className={`guidance-progress-rail${compact ? ' is-compact' : ''}`}
      aria-label={`导航进度：${status}；已走${formatDistance(progress)}，剩余${formatDistance(remaining)}，全程${formatDistance(total)}`}
      data-located={located}
      data-status={session.arrived ? 'arrived' : session.offRoute ? 'off-route' : located ? 'located' : 'waiting'}
    >
      <span className="guidance-progress-end guidance-progress-destination">
        <span>终</span>
        <small>{shortDistance(total)}</small>
      </span>
      <div
        className="guidance-progress-track"
        role="progressbar"
        aria-label="已走路线进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={hasConfirmedFix ? Math.round(fraction * 100) : undefined}
        aria-valuetext={`${accessibleProgress}；${status}`}
      >
        <span className="guidance-progress-fill" style={compact
          ? { width: `${hasConfirmedFix ? fraction * 100 : 0}%` }
          : { height: `${hasConfirmedFix ? fraction * 100 : 0}%` }} />
        {located && <span className="guidance-progress-thumb" style={compact
          ? { left: `${fraction * 100}%` }
          : { bottom: `${fraction * 100}%` }} />}
      </div>
      <span className="guidance-progress-end guidance-progress-origin">
        <span>起</span>
        <small>0m</small>
      </span>
      <span className="guidance-progress-distance" aria-hidden="true">
        <span>走{shortDistance(progress)}</span>
        <span>余{shortDistance(remaining)}</span>
      </span>
      <span className="guidance-progress-status" role="status" aria-label={status} title={status}>{statusLabel}</span>
    </aside>
  );
}
