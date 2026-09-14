import { useEffect, useRef, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import { planBounds } from '../outdoor/offline';
import { downloadGraph } from './download';
import {
  deleteGraph,
  listGraphs,
  loadGraph,
  saveGraph,
  verifyGraph,
} from './storage';
import { GRAPH_LIMITS, type GraphManifest } from './types';
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
      <strong>离线导航引擎 · 步行</strong>
      <RoutingModeControl />
      <p>
        下载「{name}
        」周边路网；离线计算起终点与途经点，地图选点或搜索已下载道路名。
      </p>
      <div className="outdoor-actions">
        <button
          disabled={busy}
          onClick={() =>
            void run(async (signal) => {
              const graph = await downloadGraph(
                name,
                planBounds(points),
                signal,
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
                  throw new Error('路网文件不能超过24MB');
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
            {p.nodes}节点 · {(p.bytes / 1048576).toFixed(1)}MB ·{' '}
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
        公开步行道路；高难度山径、禁行和条件不明路段不参与计算。驾车/骑行需在线规划。区域最多100km²，不能替代现场通行判断。
      </small>
      <small>© OpenStreetMap contributors · ODbL 1.0</small>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
