import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import { planBounds } from './routeBounds';
import { downloadGraph } from './download';
import {
  deleteGraph,
  listGraphs,
  loadGraph,
  saveGraph,
  verifyGraph,
} from './storage';
import { GRAPH_LIMITS, type GraphManifest, type OfflineProfile } from './types';
import { validateGraph } from './engine';
import { saveFile } from '../dataTransfer/download';
import { RoutingModeControl } from './RoutingModeControl';
import './offlineRouting.css';
export function OfflineRoutingPanel({
  points,
  name,
  onShow,
}: {
  points: Coordinate[];
  name: string;
  onShow: (points: Coordinate[]) => void;
}) {
  const [packages, setPackages] = useState<GraphManifest[]>([]),
    [profile, setProfile] = useState<OfflineProfile>('pedestrian'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const task = useRef<AbortController | null>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const refresh = () =>
      void listGraphs()
        .then(setPackages)
        .catch(() => setMessage('离线路网存储不可用'));
    refresh();
    window.addEventListener('shantu-offline-graphs-changed', refresh);
    return () => {
      task.current?.abort();
      window.removeEventListener('shantu-offline-graphs-changed', refresh);
    };
  }, []);
  const run = async (work: (signal: AbortSignal) => Promise<string>) => {
    if (task.current) return;
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    setMessage('正在处理离线路网…');
    try {
      setMessage(await work(controller.signal));
    } catch (error) {
      setMessage(
        controller.signal.aborted
          ? '操作已取消'
          : error instanceof Error
            ? error.message
            : '路网操作失败',
      );
    } finally {
      task.current = null;
      setBusy(false);
    }
  };
  return (
    <section className="offline-routing-panel" aria-label="离线导航引擎">
      <strong>离线导航引擎</strong>
      <RoutingModeControl />
      <p>
        下载「{name}
        」周边OSM路网；离线计算起终点与途经点，地图选点或搜索已下载道路名。
      </p>
      <label className="routing-mode-control">
        离线路网类型
        <select aria-label="离线路网类型" value={profile} onChange={(e) => setProfile(e.target.value as OfflineProfile)}>
          <option value="pedestrian">步行</option>
          <option value="motorcar">驾车</option>
          <option value="motorcycle">摩托车</option>
        </select>
      </label>
      <small>汽车和摩托车分别生成路网；仅按 OSM 已标注的通行、单向与已知转向限制规划。</small>
      <small>车辆离线只规划起点到终点；距道路不超过120米的虚线接入按步行估算，仅作位置提示，不表示汽车或摩托车可以驶过该段。</small>
      <div className="outdoor-actions">
        <button
          disabled={busy}
          onClick={() =>
            void run(async (signal) => {
              const graph = await downloadGraph(
                name,
                planBounds(points),
                signal,
                profile,
              );
              signal.throwIfAborted();
              const saved = await saveGraph(graph);
              return `路网已保存：${saved.nodes}节点 · ${saved.edges}连接`;
            })
          }
        >
          下载此区域路网
        </button>
        <button disabled={busy} onClick={() => input.current?.click()}>
          导入路网
        </button>
        {busy && <button onClick={() => task.current?.abort()}>取消</button>}
        <input
          ref={input}
          hidden
          type="file"
          accept=".json,application/json"
          aria-label="导入离线路网文件"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file)
              void run(async (signal) => {
                if (file.size > GRAPH_LIMITS.bytes)
                  throw new Error('路网文件不能超过24MiB');
                const graph = validateGraph(JSON.parse(await file.text()));
                signal.throwIfAborted();
                await saveGraph(graph);
                return '离线路网导入完成';
              });
          }}
        />
      </div>
      {packages.map((p) => (
        <article className="trip-package" key={p.id}>
          <strong>{p.name}</strong>
          <small>
            {p.profile === 'pedestrian' ? '步行' : p.profile === 'motorcar' ? '驾车' : '摩托车'} · {p.nodes}节点 · {p.bytes < 1048576 ? `${(p.bytes / 1024).toFixed(1)}KB` : `${(p.bytes / 1048576).toFixed(1)}MB`} ·{' '}
            {new Date(p.createdAt).toLocaleDateString()}
          </small>
          <div className="outdoor-actions">
            <button
              onClick={() =>
                onShow([
                  [p.bounds[0], p.bounds[1]],
                  [p.bounds[2], p.bounds[3]],
                ])
              }
            >
              查看路网范围
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await verifyGraph(p);
                  return '路网完整性通过（SHA256及拓扑）';
                })
              }
            >
              检查路网
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  saveFile(
                    `${p.name}.shantu-routing.json`,
                    'application/json',
                    JSON.stringify(await loadGraph(p.id)),
                  );
                  return '路网已导出，可转移设备';
                })
              }
            >
              导出路网
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await deleteGraph(p.id);
                  return '路网已移除，地图缓存未删除';
                })
              }
            >
              移除路网
            </button>
          </div>
        </article>
      ))}
      <small>
        条件通行规则与不支持的复杂转向关系会保守排除涉及道路。OSM 未标注或未覆盖的中国本地限行、禁摩、施工及临时管制无法保证识别；路线和预计时间仅供参考，不替代交通标志、现场判断或在线规划。
      </small>
      <small>© OpenStreetMap contributors · ODbL 1.0</small>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
