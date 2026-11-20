import { useMemo } from 'react';
import { Sunrise, Sunset } from 'lucide-react';
import {
  type SkyObserver,
  type SolarVisibility,
  type SkyTimeInterval,
} from './astronomy';
import type { TerrainHorizon } from './terrainHorizon';
import { SkyDayGraph } from './SkyDayGraph';
import { skyCalendarDate } from './skyCalendar';
import type { useSolarDay } from './useSolarDay';

interface Props {
  date: string;
  time: number;
  timeZone: string;
  day: SkyTimeInterval;
  observer: SkyObserver;
  terrain: TerrainHorizon | null;
  loadingTerrain: boolean;
  result: ReturnType<typeof useSolarDay>;
  onDate(value: string): void;
  onTime(time: number, aim?: boolean): void;
  onNow(): void;
}

export function SkyTimeline({
  date,
  time,
  timeZone,
  day,
  observer,
  terrain,
  loadingTerrain,
  onDate,
  onTime,
  onNow,
  result,
}: Props) {
  const usable = terrain?.status === 'unavailable' ? null : terrain;
  const done = result.done;
  const daily = result.data?.value ?? null;
  const clock = useMemo(
    () =>
      new Intl.DateTimeFormat('zh-CN', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    [timeZone],
  );
  const duration = day.endMs - day.startMs;
  const ratio = (t: number) => `${(100 * (t - day.startMs)) / duration}%`;
  const basis = result.data?.flatReference || !usable ? '平地参考' : '山脊估算';
  const eventName = (kind: 'rise' | 'set') =>
    kind === 'rise' ? '日出' : '日落';
  return (
    <section className="sky-time-panel" aria-label="观景时间轴">
      <div className="sky-date-row">
        <input
          aria-label="观景日期"
          type="date"
          value={date}
          onChange={(e) => {
            if (e.target.value) onDate(e.target.value);
          }}
        />
        <button type="button" onClick={() => onDate(skyCalendarDate(day.endMs,timeZone))}>次日</button>
        <strong>{clock.format(time)}</strong>
        <button type="button" onClick={onNow}>
          现在
        </button>
      </div>
      <SkyDayGraph
        day={day}
        observer={observer}
        time={time}
        onTime={onTime}
        visibility={daily}
      />
      <div className="sky-rail">
        <div className="sky-track" aria-hidden="true">
          {daily?.visibleIntervals.map((i) => (
            <i
              className="sky-lit"
              key={i.startMs}
              style={{
                left: ratio(i.startMs),
                width: `${(100 * (i.endMs - i.startMs)) / duration}%`,
              }}
            />
          ))}
          {daily?.events.map((e) => (
            <i
              className="sky-event-tick"
              key={e.timeMs}
              style={{ left: ratio(e.timeMs) }}
            />
          ))}
        </div>
        <input
          aria-label="观景时间"
          aria-valuetext={clock.format(time)}
          type="range"
          min={0}
          max={duration - 1}
          step="any"
          value={Math.max(0, Math.min(duration - 1, time - day.startMs))}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              onTime(
                Math.max(
                  day.startMs,
                  Math.min(
                    day.endMs - 1,
                    time + (event.key === 'ArrowLeft' ? -60000 : 60000),
                  ),
                ),
              );
            }
          }}
          onChange={(e) => onTime(day.startMs + Number(e.target.value))}
        />
      </div>
      <div className="sky-times">
        <span>{clock.format(day.startMs)}</span>
        <span>{clock.format(day.startMs + duration / 2)}</span>
        <span>{clock.format(day.endMs - 1)}</span>
      </div>
      <div className="sky-events" aria-label="日出日落标记">
        <span>{basis}</span>
        {daily?.events.map((e) => (
          <button
            key={e.timeMs}
            type="button"
            onClick={() => onTime(e.timeMs, true)}
          >
            {e.kind === 'rise' ? (
              <Sunrise size={17} aria-hidden />
            ) : (
              <Sunset size={17} aria-hidden />
            )}
            {eventName(e.kind)} {clock.format(e.timeMs)}
          </button>
        ))}
        {!done && <span>计算中…</span>}
        {done && !daily && <span>时刻计算失败</span>}
        {daily?.status === 'all-hidden' && <span>全天未露出</span>}
        {daily?.status === 'all-visible' && <span>全天可见</span>}
        {daily?.status === 'unknown' && <span>部分方位缺地形</span>}
        {daily?.status === 'normal' && !daily.events.length && (
          <span>当日无升落交点</span>
        )}
      </div>
      <small>
        {timeZone} ·{' '}
        {loadingTerrain
          ? '正在读取山脊'
          : usable
            ? usable.status === 'complete'
              ? '已计入地形遮挡'
              : '已读取部分山脊'
            : '当地山脊无数据'}
      </small>
    </section>
  );
}
