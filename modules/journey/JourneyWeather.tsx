import { ArrowLeft, CloudRain, RefreshCw, Send } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { formatDuration } from '../navigation/types';
import { getObserverTimeZone } from '../sky/astronomy';
import { localMinute } from '../sky/journeyClock';
import type { JourneyPlaybackModel } from '../sky/journeyPlayback';
import { JourneyWeatherMap } from './JourneyWeatherMap';
import { buildJourneyWeatherLayout, timeJourneyWeatherRoute } from './journeyWeatherRoute';
import { pointAlong } from './metrics';
import { analyzeWeatherRoute, hourlyRainBand, hourlyRainBands, type WeatherRouteResult } from './routeWeatherAnalysis';
import { parseRouteWeatherQuestion } from './routeWeatherQuestion';
import { fetchRouteWeather, type RouteForecast } from './weatherProvider';
import './journeyWeather.css';

const initialQuestion = '明天几点出发';
const exampleQuestion = '明早 7 点和 9 点出发，哪段会下雨？';
const km = (value: number) => (value / 1000).toFixed(1);
const amount = (value: number) => new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 }).format(value);
const sameRank = (a: { wetMeters: number; maxRain: number | null }, b: typeof a) =>
  Math.abs(a.wetMeters - b.wetMeters) < 1 && a.maxRain === b.maxRain;
const noSegments: WeatherRouteResult['segments'] = [];

function combineWetSegments(segments: WeatherRouteResult['segments']) {
  const groups: { first: number; start: number; end: number; min: number; max: number }[] = [];
  for (const [index, segment] of segments.entries()) {
    if (segment.rain === null || segment.rain <= 0) continue;
    const last = groups.at(-1);
    const prior = segments[index - 1];
    const priorEnd = prior?.coordinates.at(-1);
    const start = segment.coordinates[0];
    if (last && prior && prior.rain !== null && prior.rain > 0 && priorEnd?.[0] === start?.[0] && priorEnd?.[1] === start?.[1]) {
      last.end = segment.endMeters;
      last.min = Math.min(last.min, segment.rain);
      last.max = Math.max(last.max, segment.rain);
    } else {
      groups.push({ first: index, start: segment.startMeters, end: segment.endMeters, min: segment.rain, max: segment.rain });
    }
  }
  return groups;
}

export function JourneyWeather({ name, model, initialDuration, onBack }: {
  name: string;
  model: JourneyPlaybackModel;
  initialDuration: number;
  onBack(): void;
}) {
  const first = model.segments[0]?.points[0]?.coordinates;
  const zone = useMemo(() => first ? getObserverTimeZone(first[1], first[0]) : 'UTC', [first]);
  const clock = (instant: number) => localMinute(instant, zone).slice(11);
  const date = (instant: number) => localMinute(instant, zone).slice(5, 10).replace('-', '月') + '日';
  const durationDefault = Math.min(72 * 3600, Math.max(60, Math.round(initialDuration || 4 * 3600)));
  const [duration, setDuration] = useState(durationDefault);
  const [durationInput, setDurationInput] = useState(() => String(Math.round(durationDefault / 60)));
  const [editingDuration, setEditingDuration] = useState(false);
  const [departures, setDepartures] = useState(() => parseRouteWeatherQuestion(initialQuestion, Date.now(), undefined, zone).departures);
  const [selected, setSelected] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [question, setQuestion] = useState('');
  const [questionError, setQuestionError] = useState('');
  const [forecast, setForecast] = useState<RouteForecast | null>(null);
  const [forecastError, setForecastError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const layout = useMemo(() => buildJourneyWeatherLayout(model), [model]);
  const route = useMemo(() => timeJourneyWeatherRoute(layout, duration), [layout, duration]);

  useEffect(() => {
    if (!layout.stops.length) {
      setLoading(false);
      return;
    }
    const request = new AbortController();
    setLoading(true);
    setForecastError('');
    void fetchRouteWeather(layout.stops, request.signal, { liquidRain: true, refresh: refresh > 0 })
      .then(value => { if (!request.signal.aborted) setForecast(value); })
      .catch(() => { if (!request.signal.aborted) setForecastError('预报暂时无法获取，请重试。'); })
      .finally(() => { if (!request.signal.aborted) setLoading(false); });
    return () => request.abort();
  }, [layout, refresh]);

  const results = useMemo(() => departures.map(time => analyzeWeatherRoute(route, forecast, time)), [route, forecast, departures]);
  const eligible = results.filter(option => option.unknownMeters < 1 && option.maxRain !== null);
  const best = eligible.slice().sort((a, b) => a.wetMeters - b.wetMeters || (a.maxRain ?? Infinity) - (b.maxRain ?? Infinity))[0];
  const ranked = best && eligible.length === results.length && results.length > 1 ? eligible.filter(option => sameRank(option, best)) : [];
  const selectedIndex = selected ?? (ranked.length === 1 ? results.indexOf(ranked[0]) : 0);
  const result = results[selectedIndex] ?? results[0];
  const segments = result?.segments ?? noSegments;
  const wetGroups = useMemo(() => combineWetSegments(segments), [segments]);
  const index = segments.findIndex(segment => elapsed < segment.endSeconds);
  const activeIndex = index < 0 ? segments.length - 1 : index;
  const active = segments[activeIndex];
  const sampleFraction = active ? Math.max(0, Math.min(1, (elapsed - active.startSeconds) / (active.endSeconds - active.startSeconds))) : 0;
  const distance = active ? active.startMeters + (active.endMeters - active.startMeters) * sampleFraction : 0;
  const cursor = active ? pointAlong(active.coordinates, distance - active.startMeters) : null;
  const arrival = result ? result.departure + elapsed * 1000 : null;
  const hourStart = active ? Math.floor(active.arrival / 3600000) * 3600000 : null;

  const selectSegment = (segmentIndex: number) => {
    const segment = segments[segmentIndex];
    if (segment) setElapsed((segment.startSeconds + segment.endSeconds) / 2);
  };
  const ask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const intent = parseRouteWeatherQuestion(question.trim(), Date.now(), result?.departure, zone);
    setQuestionError(intent.error ?? '');
    if (intent.error) return;
    if (intent.departures.length) {
      setDepartures(intent.departures);
      setSelected(/几点|什么时候|什么时间|建议|避雨/.test(question) ? null : 0);
      setElapsed(0);
      return;
    }
    const wet = segments.findIndex(segment => (segment.rain ?? 0) > 0);
    if (wet >= 0) selectSegment(wet);
  };
  const applyDuration = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const minutes = Number(durationInput);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 4320) return;
    setDuration(minutes * 60);
    setElapsed(0);
    setEditingDuration(false);
  };
  const routeSummary = result?.maxRain === null || !result
    ? loading ? '正在获取逐小时预报…' : forecast ? '所选时段暂无预报覆盖。' : '等待可用的天气数据。'
    : result.wetMeters > 0
      ? `预计 ${km(result.wetMeters)} 公里路段有雨 · 最大小时雨量 ${amount(result.maxRain)} mm`
      : result.unknownMeters > 1 ? '有预报的沿途路段暂无降雨。' : '沿途预报暂无降雨。';

  return <section className="journey-viewer journey-weather" role="dialog" aria-modal="true" aria-label="沿途天气"
    onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (editingDuration) setEditingDuration(false); else onBack(); } }}>
    <header className="route-weather-heading">
      <button type="button" className="route-weather-back" aria-label="返回行程模拟" onClick={onBack}><ArrowLeft size={18}/></button>
      <div><h2>沿途天气</h2><small>{name}</small></div>
      <button type="button" className="route-weather-refresh" aria-label="刷新天气预报" disabled={loading || !layout.stops.length} onClick={() => setRefresh(value => value + 1)}>
        <RefreshCw size={16} aria-hidden="true"/>
      </button>
    </header>
    <div className="route-weather-map-slot">
      <JourneyWeatherMap geometry={layout.segments} segments={segments} activeIndex={activeIndex} cursor={cursor} onSelect={selectSegment}/>
      <div className="route-weather-legend" aria-label="小时雨量图例">
        <span>小时雨量 · mm</span>
        <div>{hourlyRainBands.map(band => <span key={band.kind} data-kind={band.kind}>{band.label}</span>)}</div>
      </div>
    </div>
    <div className="route-weather-sheet">
      <form className="route-weather-query" onSubmit={ask}>
        <input aria-label="询问沿途天气" placeholder={exampleQuestion} value={question}
          onChange={event => { setQuestion(event.currentTarget.value); setQuestionError(''); }} maxLength={180} required/>
        <button type="submit" aria-label="查询沿途天气"><Send size={16}/>查询</button>
      </form>
      {questionError && <p className="route-weather-feedback" role="alert">{questionError}</p>}
      {forecastError && <p className="route-weather-feedback" role="status">{forecastError}</p>}
      <div className="route-weather-comparison-title">
        <strong>出发时间对比</strong>
        <button type="button" aria-expanded={editingDuration} onClick={() => setEditingDuration(value => !value)}>用时 {formatDuration(duration)}</button>
      </div>
      {editingDuration && <form className="route-weather-duration" onSubmit={applyDuration}>
        <label>预计行程 <input aria-label="预计行程分钟" type="number" min={1} max={4320} step={1} value={durationInput}
          onChange={event => setDurationInput(event.currentTarget.value)} required/> 分钟</label>
        <button type="submit">应用</button>
      </form>}
      <div className="route-weather-options" aria-label="可比较的出发时间">
        {results.map((option, i) => {
          const recommended = ranked.length === 1 && ranked[0] === option && option.maxRain !== null;
          return <button key={option.departure} type="button" className="route-weather-option" aria-pressed={selectedIndex === i}
            onClick={() => setSelected(i)}>
            <span className="route-weather-option-time"><time dateTime={new Date(option.departure).toISOString()}>{clock(option.departure)}</time><small>{date(option.departure)}</small></span>
            <span>{option.maxRain === null ? '待更新' : option.unknownMeters > 1 ? '部分覆盖' : option.wetMeters > 0 ? `遇雨 ${km(option.wetMeters)} km` : '沿途无雨'}</span>
            <small>{recommended ? '优先 · ' : ''}{option.maxRain !== null ? `峰值 ${amount(option.maxRain)} mm` : '小时雨量'}</small>
          </button>;
        })}
      </div>
      <p className="route-weather-summary" role="status"><CloudRain size={15} aria-hidden="true"/><span>{routeSummary}{result && result.unknownMeters > 1 && result.maxRain !== null ? ` · ${km(result.unknownMeters)} 公里暂无数据` : ''}</span></p>
      {wetGroups.length > 0 && <div className="route-weather-rain-parts" aria-label="预计降雨路段">
        {wetGroups.map(group => <button key={group.first} type="button" data-kind={hourlyRainBand(group.max)} onClick={() => selectSegment(group.first)}>
          {km(group.start)}–{km(group.end)} km · {amount(group.min)}{group.max !== group.min ? `–${amount(group.max)}` : ''} mm
        </button>)}
      </div>}
      <div className="route-weather-time">
        <div className="route-weather-time-heading">
          <strong>{arrival === null ? '沿途时间轴' : `${date(arrival)} ${clock(arrival)}`}</strong><span>{km(distance)} / {km(route.totalMeters)} km</span>
        </div>
        <div className="route-weather-scrubber">
          <div className="route-weather-track" aria-hidden="true">
            {segments.map((segment, i) => <span key={i}
              data-kind={hourlyRainBand(segment.rain)}
              style={{ flex: Math.max(0, segment.endSeconds - segment.startSeconds) }}/>)}
          </div>
          <input type="range" aria-label="沿途天气时间轴" min={0} max={duration} step="any" value={elapsed}
            aria-valuetext={arrival === null ? '' : `${date(arrival)} ${clock(arrival)}，${km(distance)} 公里`}
            disabled={!segments.length} onChange={event => setElapsed(event.currentTarget.valueAsNumber)}/>
        </div>
        <div className="route-weather-time-details">
          <span>{active ? `${km(active.startMeters)}–${km(active.endMeters)} km 路段` : '暂无路段'}</span>
          <strong data-kind={hourlyRainBand(active?.rain ?? null)}>{active?.rain != null && hourStart !== null ? `${clock(hourStart)}–${clock(hourStart + 3600000)} ${active.rain === 0 ? '无雨 · 0 mm' : `雨量 ${amount(active.rain)} mm`}` : '时段雨量待更新'}</strong>
        </div>
      </div>
      <footer>{ranked.length === 1 ? '优先按遇雨里程，其次按峰值雨量 · ' : ''}Open-Meteo{forecast ? ` · ${forecast.stale ? '缓存' : '获取'}于 ${date(forecast.fetchedAt)} ${clock(forecast.fetchedAt)}` : ''} · {zone === 'Asia/Shanghai' ? '北京时间' : zone}</footer>
    </div>
  </section>;
}
