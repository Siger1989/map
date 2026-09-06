import { useState } from 'react';
import { formatDistance, type Coordinate } from '../navigation/types';
import { trackDistance } from '../tracks/drawing';
import { nearestOnRoute } from '../journey/routeProgress';
import {
  collectData,
  exportGPX,
  exportKML,
  mergeData,
  parseFile,
  saveFile,
  type Transfer,
} from './exchange';
import type { useRecording } from './useRecording';
import type { useOffline } from './useOffline';
export function OutdoorPanel({
  recorder,
  offline,
  points,
  name,
  onShow,
  onOpenMap,
}: {
  recorder: ReturnType<typeof useRecording>;
  offline: ReturnType<typeof useOffline>;
  points: Coordinate[];
  name: string;
  onShow: (points: Coordinate[]) => void;
  onOpenMap: () => void;
}) {
  const [tab, setTab] = useState<'record' | 'files' | 'offline'>('record'),
    [message, setMessage] = useState(''),
    [pending, setPending] = useState<Transfer | null>(null),
    [loading, setLoading] = useState(false);
  const { record, native, command } = recorder;
  const segments = record.segments
    .filter((s) => s.length >= 2)
    .map((s) => s.map((p) => p.coordinates));
  const count = record.segments.reduce((n, s) => n + s.length, 0),
    last = record.segments.flat().at(-1);
  const deviation =
    last && points.length > 1
      ? nearestOnRoute(points, last.coordinates).offset
      : null;
  const act = (work: () => void) => {
    try {
      work();
      setMessage('操作完成');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const recordingData = (): Transfer => ({
    format: 'guanyun-backup',
    version: 1,
    tracks: [
      {
        id: record.id,
        name: `实走 ${new Date(record.startedAt).toLocaleString('zh-CN')}`,
        createdAt: record.startedAt,
        segments,
        samples: record.segments
          .filter((s) => s.length >= 2)
          .map((s) => s.map((p) => ({ time: p.time, altitude: p.altitude }))),
      },
    ],
    annotations: [],
    favorites: [],
  });
  return (
    <div className="outdoor-panel">
      <nav className="route-tabs" aria-label="行程工具">
        {(['record', 'files', 'offline'] as const).map((id, i) => (
          <button
            key={id}
            aria-pressed={tab === id}
            onClick={() => {
              setTab(id);
              setMessage('');
            }}
          >
            {['实走记录', '数据', '离线'][i]}
          </button>
        ))}
      </nav>
      {tab === 'record' && (
        <>
          <div className="trip-metrics">
            <strong>{formatDistance(trackDistance(segments))}</strong>
            <span>
              {count} 点 ·{' '}
              {
                {
                  idle: '未开始',
                  recording: '记录中',
                  paused: '已暂停',
                  finished: '待保存',
                }[record.phase]
              }
            </span>
          </div>
          <p className="route-note">
            {native
              ? '开始后显示系统记录通知，锁屏后继续定位。'
              : '网页版仅在前台记录；锁屏记录请使用安卓安装包。'}
          </p>
          {last && (
            <p className="route-note">
              定位精度 ±{Math.round(last.accuracy)} m · 最新{' '}
              {new Date(last.time).toLocaleTimeString('zh-CN')}
            </p>
          )}
          {deviation !== null && (
            <p className={deviation > 100 ? 'route-error' : 'route-note'}>
              距所选路线 {formatDistance(deviation)}
              {deviation > 100 ? ' · 可能已偏离路线' : ''}
            </p>
          )}
          <div className="outdoor-actions">
            {record.phase === 'idle' ? (
              <button onClick={() => command('start')}>开始记录</button>
            ) : (
              <>
                {record.phase === 'recording' && (
                  <button onClick={() => command('pause')}>暂停</button>
                )}
                {record.phase === 'paused' && (
                  <button onClick={() => command('resume')}>继续记录</button>
                )}
                {record.phase !== 'finished' && (
                  <button onClick={() => command('finish')}>结束记录</button>
                )}
                {record.phase === 'finished' && (
                  <button
                    disabled={!segments.length}
                    onClick={() =>
                      act(() => {
                        mergeData(recordingData());
                        command('clear');
                      })
                    }
                  >
                    保存到轨迹
                  </button>
                )}
                <button
                  disabled={!segments.length}
                  onClick={() =>
                    act(() =>
                      saveFile(
                        'guanyun-recording.gpx',
                        'application/gpx+xml',
                        exportGPX(recordingData()),
                      ),
                    )
                  }
                >
                  导出 GPX
                </button>
                <button
                  disabled={!segments.length}
                  onClick={() => onShow(segments.flat())}
                >
                  查看全程
                </button>
                {record.phase !== 'recording' && !segments.length && (
                  <button onClick={() => command('clear')}>
                    清除无有效线段记录
                  </button>
                )}
              </>
            )}
          </div>
          {record.error && (
            <p role="status" className="route-error">
              {record.error}
            </p>
          )}
        </>
      )}
      {tab === 'files' && (
        <>
          <label className="import-file">
            导入 GPX / KML / KMZ / JSON
            <input
              type="file"
              accept=".gpx,.kml,.kmz,.json"
              disabled={loading}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setLoading(true);
                setPending(null);
                try {
                  setPending(await parseFile(file));
                  setMessage('已校验，请确认导入内容');
                } catch (error) {
                  setMessage((error as Error).message);
                } finally {
                  setLoading(false);
                }
              }}
            />
          </label>
          {pending && (
            <div className="import-preview">
              <p>
                {pending.tracks.length} 条轨迹 · {pending.annotations.length}{' '}
                个标记 · {pending.favorites.length} 条收藏
              </p>
              <p className="route-note">
                合并到本机；保留已有数据。相同内容不会重复导入。
              </p>
              <div className="outdoor-actions">
                <button
                  onClick={() =>
                    act(() => {
                      mergeData(pending);
                      setPending(null);
                    })
                  }
                >
                  确认合并
                </button>
                <button onClick={() => setPending(null)}>取消</button>
              </div>
            </div>
          )}
          <div className="outdoor-actions">
            <button
              onClick={() =>
                act(() =>
                  saveFile(
                    'guanyun-backup.json',
                    'application/json',
                    JSON.stringify(collectData(), null, 2),
                  ),
                )
              }
            >
              存档备份
            </button>
            <button
              onClick={() =>
                act(() =>
                  saveFile(
                    'guanyun-tracks.gpx',
                    'application/gpx+xml',
                    exportGPX(collectData()),
                  ),
                )
              }
            >
              导出 GPX
            </button>
            <button
              onClick={() =>
                act(() =>
                  saveFile(
                    'guanyun-tracks.kml',
                    'application/vnd.google-earth.kml+xml',
                    exportKML(collectData()),
                  ),
                )
              }
            >
              导出 KML
            </button>
          </div>
          <p className="route-note">
            JSON 保留标记模型、手绘轨迹和路线收藏。GPX / KML
            交换点线；不含模型外观、KML 原文件时间与海拔。每个文件 ≤8
            MB、每条轨迹 ≤6000 点，本机最多 20 条轨迹 / 20 条收藏 / 80 个标记。
          </p>
        </>
      )}
      {tab === 'offline' && (
        <>
          <p className="route-note">
            下载「{name}」周边约 2 km 的开源道路、地名与地形。道路精细至 14
            级，地形至 12
            级；更高缩放放大已有数据。卫星、天气更新和在线搜索不在包内。
          </p>
          <div className="outdoor-actions">
            <button
              disabled={offline.busy}
              onClick={() => void offline.create(name, points)}
            >
              下载此行程
            </button>
            <button onClick={onOpenMap}>使用开源底图</button>
            {offline.busy && <button onClick={offline.pause}>暂停下载</button>}
          </div>
          {offline.packages.map((p) => (
            <article className="trip-package" key={p.id}>
              <strong>{p.name}</strong>
              <progress value={p.done} max={p.urls.length} />
              <span>
                {p.complete ? '已下载' : '待补齐'} · {p.done}/{p.urls.length} ·{' '}
                {(p.bytes / 1048576).toFixed(1)} MB
              </span>
              <div className="outdoor-actions">
                <button
                  onClick={() => {
                    onOpenMap();
                    onShow([
                      [p.bounds[0], p.bounds[1]],
                      [p.bounds[2], p.bounds[3]],
                    ]);
                  }}
                >
                  打开范围
                </button>
                <button
                  disabled={offline.busy}
                  onClick={() => void offline.resume(p)}
                >
                  继续 / 补齐
                </button>
                <button
                  disabled={offline.busy}
                  onClick={() => void offline.verify(p)}
                >
                  检查完整性
                </button>
                <button
                  disabled={offline.busy}
                  onClick={() => void offline.remove(p)}
                >
                  移除缓存
                </button>
              </div>
            </article>
          ))}
          <p className="route-note">
            下载时请保持应用在前台；完成后在飞行模式下检查行程范围；清理应用数据会删除离线包。
          </p>
          {offline.message && (
            <p role="status" className="route-note">
              {offline.message}
            </p>
          )}
        </>
      )}
      {(message || loading) && (
        <p role="status" className="route-note">
          {loading ? '校验文件…' : message}
        </p>
      )}
    </div>
  );
}
