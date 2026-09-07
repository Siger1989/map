import { Navigation, X, RefreshCw, LocateFixed } from 'lucide-react';
import { formatDistance, TRAVEL_MODES } from '../navigation/types';
import type { GuidanceState } from './useGuidance';
import './guidance.css';

export function GuidanceCard({
  guidance: g,
  onStop,
  onFollow,
  onShow,
  following,
}: {
  guidance: GuidanceState;
  onStop: () => void;
  onFollow: () => void;
  onShow: () => void;
  following: boolean;
}) {
  const s = g.session;
  if (!s) return null;
  const status = s.arrived
    ? '已到达终点'
    : s.quality ||
      (s.offRoute
        ? g.loading
          ? '正在计算接回路线…'
          : g.rejoin
            ? '沿橙线接回原路线'
            : `已偏离约${formatDistance(s.offset)}`
        : s.offSince !== null
          ? '可能偏离，正在确认…'
          : '沿原路线导航');
  return (
    <section
      className="guidance-card glass"
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
        <strong>
          <Navigation size={17} />
          {s.arrived
            ? '导航完成'
            : `导航中 · ${TRAVEL_MODES.find((m) => m.id === s.route.mode)?.label}`}
        </strong>
        <button onClick={onStop} aria-label="结束导航">
          <X size={18} />
        </button>
      </header>
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
            <dt>{s.offRoute && !g.rejoin ? '原路线剩余' : '剩余约'}</dt>
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
        {s.offRoute && !g.online && (
          <p className="guidance-error" role="status">
            网络已断开，接回路线需要联网计算。
          </p>
        )}
        {g.error && (
          <p className="guidance-error" role="alert">
            {g.error}
          </p>
        )}
        {!s.arrived && (
          <div className="guidance-actions">
            <button onClick={onFollow}>
              <LocateFixed size={16} />
              {following ? '当前位置' : '恢复跟随'}
            </button>
            {s.offRoute && (
              <button
                onClick={g.rejoin ? onShow : g.retry}
                disabled={g.loading || !!s.quality || !g.online}
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
        )}
        {s.gap && (
          <p className="guidance-note">定位中断或精度不足期间未累加距离。</p>
        )}
      </div>
    </section>
  );
}
