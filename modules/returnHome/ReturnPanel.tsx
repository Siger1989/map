import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import { formatDistance, metresBetween } from '../navigation/types';
import type { RouteFavorite } from '../navigation/favorites';
import type { ManualTrack } from '../tracks/drawing';
import type { Recording } from '../outdoor/recording';
import type { PositionFix } from '../position/types';
import type { Annotation } from '../annotations/data';
import { tryOfflineRoute } from '../offlineRouting/provider';
import { breadcrumbReturn, returnBearing } from './breadcrumbs';

const places = [
  { name: '车位', icon: 'parking' },
  { name: '营地', icon: 'camp' },
  { name: '撤退点', icon: 'gate' },
] as const;
export function ReturnPanel({
  tracks,
  record,
  fix,
  center,
  markers,
  onRemember,
  onNavigate,
  onShow,
}: {
  tracks: ManualTrack[];
  record: Recording;
  fix: PositionFix | null;
  center: Coordinate;
  markers: Annotation[];
  onRemember: (
    point: Coordinate,
    defaults: Pick<Annotation, 'name' | 'icon'>,
  ) => boolean;
  onNavigate: (favorite: RouteFavorite) => void;
  onShow: (points: Coordinate[]) => void;
}) {
  const [source, setSource] = useState('record'),
    [part, setPart] = useState(-1),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const segments =
    source === 'record'
      ? record.segments.map((line) => line.map((p) => p.coordinates))
      : (tracks.find((t) => t.id === source)?.segments ?? []);
  const index = part < 0 ? segments.length - 1 : part;
  const current = () =>
    fix &&
    fix.source !== 'network' &&
    fix.accuracy <= 80 &&
    Date.now() - fix.timestamp < 30000 &&
    fix.timestamp <= Date.now() + 5000
      ? fix.coordinates
      : null;
  const [useCenter, setUseCenter] = useState(false);
  const go = async (marker: Annotation) => {
    const origin = current();
    if (!origin) {
      setMessage('请先在下方开启GPS定位，等待可靠位置');
      return;
    }
    const abort = new AbortController();
    controller.current?.abort();
    controller.current = abort;
    setBusy(true);
    setMessage('正在本地计算返回路线…');
    try {
      const start = { name: '当前位置', coordinates: origin },
        end = { name: marker.name, coordinates: marker.coordinates };
      const route = await tryOfflineRoute(
        [start, end],
        'pedestrian',
        abort.signal,
        'offline',
      );
      abort.signal.throwIfAborted();
      if (route)
        onNavigate({
          id: `return-${marker.id}`,
          name: `返回${marker.name}`,
          savedAt: Date.now(),
          start,
          end,
          route,
        });
    } catch (error) {
      if (!abort.signal.aborted)
        setMessage(error instanceof Error ? error.message : '返航计算失败');
    } finally {
      if (!abort.signal.aborted) setBusy(false);
    }
  };
  return (
    <section className="offline-panel">
      <strong>沿轨迹返航</strong>
      <label>
        轨迹
        <select
          value={source}
          onChange={(e) => {
            setSource(e.target.value);
            setPart(-1);
          }}
        >
          <option value="record">当前实走记录</option>
          {tracks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        连续段
        <select value={index} onChange={(e) => setPart(Number(e.target.value))}>
          {segments.map((line, i) => (
            <option key={i} value={i}>
              第{i + 1}段 · {line.length}点
              {i === segments.length - 1 ? ' · 最近' : ''}
            </option>
          ))}
        </select>
      </label>
      <small>按原点序倒走；暂停缺口分段选择，不跨缺口连线。</small>
      <button
        disabled={busy || !segments[index]?.length}
        onClick={() => {
          try {
            onNavigate(
              breadcrumbReturn(
                source === 'record'
                  ? '实走记录'
                  : tracks.find((t) => t.id === source)!.name,
                segments,
                index,
              ),
            );
          } catch (error) {
            setMessage((error as Error).message);
          }
        }}
      >
        预览此段返航
      </button>
      <strong>车位 / 营地 / 撤退点</strong>
      <label>
        <input
          type="checkbox"
          checked={useCenter}
          onChange={(e) => setUseCenter(e.target.checked)}
        />
        使用地图中心保存（手动指定）
      </label>
      <div className="route-share-actions">
        {places.map((p) => (
          <button
            key={p.icon}
            onClick={() => {
              const point = useCenter ? center : current();
              if (!point) {
                setMessage('请先开启GPS，或选择使用地图中心');
                return;
              }
              setMessage(
                onRemember(point, p)
                  ? `已保存${p.name}，可在收藏中修改`
                  : '保存失败，请检查标记存储',
              );
            }}
          >
            记{p.name}
          </button>
        ))}
      </div>
      {markers
        .filter(
          (m) => m.kind === 'pin' && places.some((p) => p.icon === m.icon),
        )
        .map((m) => (
          <div key={m.id} className="offline-package">
            <strong>{m.name}</strong>
            <small>
              {current()
                ? `直线 ${formatDistance(metresBetween(fix!.coordinates, m.coordinates))} · 真北方位 ${Math.round(returnBearing(fix!.coordinates, m.coordinates))}°（非道路距离）`
                : '开启可靠GPS后显示距离与方位'}
            </small>
            <div className="route-share-actions">
              <button
                onClick={() =>
                  onShow([
                    ...(current() ? [fix!.coordinates] : []),
                    m.coordinates,
                  ])
                }
              >
                地图查看
              </button>
              <button disabled={busy} onClick={() => void go(m)}>
                离线路网返航
              </button>
            </div>
          </div>
        ))}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
