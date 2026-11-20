import { Sunrise, Sunset } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { getLocalDayBounds, getObserverTimeZone } from './astronomy';
import { loadTerrainHorizon, type TerrainHorizon } from './terrainHorizon';
import { useSolarDay } from './useSolarDay';

const MINUTE = 60_000;

export default function LiveMarkerSolarDay({ lng, lat }: { lng: number; lat: number }) {
  const [now, setNow] = useState(Date.now);
  const [terrainResult, setTerrainResult] = useState<{ lng: number; lat: number; value: TerrainHorizon | null } | null>(null);
  const currentTerrain = terrainResult?.lng === lng && terrainResult.lat === lat ? terrainResult : null;
  const terrain = currentTerrain?.value ?? null;
  const loadingTerrain = currentTerrain === null;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      const time = Date.now();
      setNow(time);
      timer = setTimeout(update, MINUTE - time % MINUTE);
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadTerrainHorizon({ lng, lat }, controller.signal)
      .catch(() => null)
      .then(value => {
        if (!controller.signal.aborted) setTerrainResult({ lng, lat, value });
      });
    return () => controller.abort();
  }, [lng, lat]);

  const timeZone = useMemo(() => getObserverTimeZone(lat, lng), [lat, lng]);
  const calendar = useMemo(() => new Intl.DateTimeFormat('en-CA', {
    timeZone, calendar: 'gregory', numberingSystem: 'latn',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }), [timeZone]);
  const parts = calendar.formatToParts(now);
  const date = ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)?.value).join('-');
  const clock = useMemo(() => new Intl.DateTimeFormat('zh-CN', {
    timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }), [timeZone]);
  const day = useMemo(() => getLocalDayBounds(date, timeZone), [date, timeZone]);
  const observer = useMemo(() => ({ longitude: lng, latitude: lat, elevationM: terrain?.observerAltitudeMeters ?? undefined }), [lng, lat, terrain]);
  const result = useSolarDay(day, observer, terrain);
  const [lastReference, setLastReference] = useState<{
    key: string;
    data: NonNullable<typeof result.data>;
  } | null>(null);
  const dayKey = `${lng}/${lat}/${day.startMs}`;
  useEffect(() => {
    if (result.data) setLastReference({ key: dayKey, data: result.data });
  }, [dayKey, result.data]);
  // Keep the same point and date's completed flat result during DEM recomputation.
  const displayData = result.data ?? (lastReference?.key === dayKey ? lastReference.data : null);
  const daily = displayData?.value;
  const pending = !daily && !result.done;
  const basis = loadingTerrain
    ? '山脊采样中 · 平地参考'
    : !terrain || terrain.status === 'unavailable'
      ? '地形未取得 · 平地参考'
      : !result.done
        ? displayData?.flatReference ? '山脊计算中 · 平地参考' : '山脊计算中'
        : !result.data && displayData?.flatReference
          ? '山脊计算失败 · 平地参考'
          : displayData?.flatReference
            ? '日出日落方位缺地形 · 平地参考'
            : daily ? '山脊估算' : '山脊计算失败';
  const duration = day.endMs - day.startMs;
  const percent = (time: number) => (100 * (time - day.startMs)) / duration;
  return <section className="marker-solar-day" aria-label="标记点日出日落时间轴">
    <div className="marker-solar-time">
      <time dateTime={date}>{date}</time>
      <time dateTime={new Date(now).toISOString()} aria-label="标记当地时间">当地 {clock.format(now)}</time>
    </div>
    <div className="marker-solar-diagram" aria-hidden="true">
      <div className="marker-solar-symbols">
        {daily?.events.map(event => {
          const Icon=event.kind==='rise'?Sunrise:Sunset;
          return <span key={event.timeMs} className={'marker-solar-symbol '+event.kind}
            style={{left:`clamp(9px, ${percent(event.timeMs)}%, calc(100% - 9px))`}}>
            <Icon size={17} strokeWidth={2}/>
          </span>;
        })}
      </div>
      <div className="marker-solar-rail">
      {daily?.visibleIntervals.map(interval => <i key={interval.startMs} className="marker-solar-light"
        style={{ left: percent(interval.startMs) + '%', width: percent(interval.endMs) - percent(interval.startMs) + '%' }} />)}
      {daily?.events.map(event => <i key={event.timeMs} className="marker-solar-event" style={{ left: percent(event.timeMs) + '%' }} />)}
      <i className="marker-solar-now" style={{ left: percent(now) + '%' }} />
    </div>
    </div>
    <div className="marker-solar-times" aria-hidden="true">
      <span>{clock.format(day.startMs)}</span><span>{clock.format(day.endMs - 1)}</span>
    </div>
    <div className="marker-solar-crossings">
      {daily?.events.map(event => {
        const rising=event.kind==='rise', Icon=rising?Sunrise:Sunset;
        return <span className="marker-solar-caption" key={event.timeMs}><Icon size={15} strokeWidth={2} aria-hidden="true" className={event.kind}/>{rising?'日出':'日落'} {clock.format(event.timeMs)}</span>;
      })}
      {daily?.status === 'all-visible' && <span>全天可见</span>}
      {daily?.status === 'all-hidden' && <span>全天未露出</span>}
      {daily?.status === 'unknown' && <span>部分方位缺地形</span>}
      {pending && <span>计算中…</span>}
      {result.done && !daily && <span>时刻计算失败</span>}
    </div>
    <small className="marker-solar-basis" title={timeZone}>
      {basis}
    </small>
  </section>;
}
