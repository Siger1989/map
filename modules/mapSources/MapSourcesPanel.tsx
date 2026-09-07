import { useEffect, useRef, useState } from 'react';
import type { useMapSources } from './useMapSources';
import {
  MAX_CONFIG_BYTES,
  MAX_FILE_BYTES,
  type Bounds,
  type MapDraft,
} from './types';
import { parseMapConfig, resolveMapInput } from './online';
import { inspectOffline } from './offlineClient';
import { readQr } from './qr';
import { QrCamera } from './QrCamera';
import { basemapConfiguration } from '../cartography/basemaps';
import './mapSources.css';

type Pending = { draft: MapDraft; blob?: Blob };
export function MapSourcesPanel({
  sources,
  builtin,
  onBuiltin,
  onFocus,
}: {
  sources: ReturnType<typeof useMapSources>;
  builtin: 'terrain' | 'detail' | 'latest';
  onBuiltin: (id: 'terrain' | 'detail' | 'latest') => void;
  onFocus: (bounds: Bounds) => void;
}) {
  const [step, setStep] = useState<'list' | 'add' | 'camera' | 'preview'>(
    'list',
  );
  const [input, setInput] = useState(''),
    [name, setName] = useState('');
  const [scheme, setScheme] = useState('xyz');
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState('');
  const domestic = basemapConfiguration().domestic;
  const work = useRef<AbortController | null>(null);
  const root = useRef<HTMLElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const scroller = root.current?.closest('.dock-content');
    if (scroller) scroller.scrollTop = 0;
  }, [step]);
  useEffect(() => {
    if (error) alert.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);
  useEffect(
    () => () => {
      work.current?.abort();
    },
    [],
  );
  const cancel = () => {
    work.current?.abort();
    work.current = null;
    setBusy(false);
  };
  const run = async (task: (signal: AbortSignal) => Promise<void>) => {
    cancel();
    const abort = new AbortController();
    work.current = abort;
    setBusy(true);
    setError('');
    const timeout = setTimeout(
      () => abort.abort(new Error('读取超时，请重试或选择较小的文件')),
      60000,
    );
    try {
      await task(abort.signal);
    } catch (e) {
      if (work.current === abort)
        setError(
          abort.signal.aborted
            ? '读取已取消或超时，请重试'
            : e instanceof Error
              ? e.message
              : '地图读取失败，请检查文件或服务是否允许跨域访问',
        );
    } finally {
      clearTimeout(timeout);
      if (work.current === abort) {
        work.current = null;
        setBusy(false);
      }
    }
  };
  const preview = (items: Pending[]) => {
    setPending(items);
    setStep('preview');
  };
  const readInput = () =>
    run(async (signal) => {
      const drafts = await resolveMapInput(input, signal);
      if (signal.aborted) return;
      preview(
        drafts.map((draft) => ({
          draft: {
            ...draft,
            name: name.trim().slice(0, 80) || draft.name,
            ...(/^https:\/\//i.test(input.trim()) &&
            /[{}]/.test(input) &&
            (draft.format === 'XYZ' || draft.format === 'TMS')
              ? {
                  scheme: scheme as 'xyz' | 'tms',
                  format: scheme.toUpperCase(),
                }
              : {}),
          },
        })),
      );
    });
  const file = (selected?: File) => {
    if (!selected) return;
    void run(async (signal) => {
      if (/\.(mbtiles|tiff?)$/i.test(selected.name)) {
        if (selected.size > MAX_FILE_BYTES)
          throw new Error('离线地图单个文件不能超过 64 MB，请先切片或缩小范围');
        const result = await inspectOffline(selected, signal);
        if (!signal.aborted) preview([result]);
      } else if (/\.(json|xml|txt)$/i.test(selected.name)) {
        if (selected.size > MAX_CONFIG_BYTES)
          throw new Error('图源配置不能超过 1 MB');
        const text = await selected.text();
        if (!signal.aborted)
          preview(parseMapConfig(text).map((draft) => ({ draft })));
      } else
        throw new Error(
          /\.ovmap$/i.test(selected.name)
            ? '奥维 .ovmap 属于专有格式，请向提供方索取标准栅格文件或通用图源地址'
            : '此处支持 MBTiles、GeoTIFF、JSON / XML / TXT 配置；GPX / KML / KMZ 轨迹请到“行程”导入',
        );
    });
  };
  const qr = (text: string) => {
    setInput(text);
    setName('');
    setStep('add');
    setError('已识别二维码，请检查内容，再点“识别并预览”');
  };
  return (
    <section ref={root} className="map-sources" aria-label="地图图源管理">
      {step === 'list' && (
        <>
          <div className="map-source-builtins" aria-label="内置图源">
            {(
              [
                ['terrain', '地形地图'],
                ['detail', '地表影像'],
                ['latest', '最新云况'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                disabled={id === 'latest' && domestic}
                title={
                  id === 'latest' && domestic
                    ? '当前天地图配置不提供最新云况影像'
                    : undefined
                }
                aria-pressed={!sources.selected && builtin === id}
                onClick={() => onBuiltin(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            className="map-source-add"
            disabled={!sources.ready}
            onClick={() => {
              setStep('add');
              setError('');
            }}
          >
            ＋ 添加地图 · 图源 / 文件 / 二维码
          </button>
          <p className="map-source-hint">
            已保存 {sources.maps.length} / 20 项 ·{' '}
            {(
              sources.maps.reduce((sum, m) => sum + m.bytes, 0) /
              1024 /
              1024
            ).toFixed(1)}{' '}
            / 256 MB
          </p>
          {[...sources.maps]
            .sort(
              (a, b) =>
                Number(b.id === sources.selected) -
                Number(a.id === sources.selected),
            )
            .map((map) => (
              <div className="map-source-row" key={map.id}>
                <button
                  className="map-source-choice"
                  aria-pressed={sources.selected === map.id}
                  onClick={() => {
                    sources.select(map.id);
                    if (map.bounds) onFocus(map.bounds);
                  }}
                >
                  <strong>{map.name}</strong>
                  <small>
                    {map.format} · {map.kind === 'online' ? '在线' : '离线'}
                    {sources.selected === map.id ? ' · 当前' : ''}
                  </small>
                </button>
                <button
                  aria-label={`移除 ${map.name}`}
                  onClick={() => setRemoving(map.id)}
                >
                  移除
                </button>
                {removing === map.id && (
                  <div className="map-source-confirm">
                    <p>从本机地图库移除？原始文件仍保留。</p>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await sources.remove(map.id);
                          setRemoving('');
                        })
                      }
                    >
                      确认移除
                    </button>
                    <button onClick={() => setRemoving('')}>取消</button>
                  </div>
                )}
              </div>
            ))}
          {!sources.maps.length && (
            <p className="map-source-hint">
              可添加在线图源，也可选择本机 MBTiles / GeoTIFF 离线影像。
            </p>
          )}
          {sources.status && <p role="status">{sources.status}</p>}
        </>
      )}
      {step === 'add' && (
        <>
          <div className="map-source-actions">
            <button
              onClick={() => {
                cancel();
                setStep('list');
                setError('');
              }}
            >
              返回列表
            </button>
            <button
              disabled={busy}
              onClick={() => {
                setError('');
                setStep('camera');
              }}
            >
              相机扫码
            </button>
            <label className="map-file-button">
              二维码图片
              <input
                disabled={busy}
                aria-label="选择二维码图片"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f)
                    void run(async (signal) => {
                      const text = await readQr(f);
                      if (!signal.aborted) qr(text);
                    });
                }}
              />
            </label>
          </div>
          <label>
            名称（可选）
            <input
              aria-label="图源名称"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：徒步地形图"
            />
          </label>
          <label>
            图源地址或配置
            <textarea
              aria-label="图源地址或配置"
              maxLength={100000}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://…/{z}/{x}/{y}.png，或粘贴 JSON / 二维码内容"
            />
          </label>
          <label className="map-source-scheme">
            瓦片行号
            <select
              aria-label="瓦片行号"
              value={scheme}
              onChange={(e) => setScheme(e.target.value)}
            >
              <option value="xyz">XYZ（从北向南）</option>
              <option value="tms">TMS（从南向北）</option>
            </select>
          </label>
          <div className="map-source-actions">
            <button disabled={busy || !input.trim()} onClick={readInput}>
              识别并预览
            </button>
            <label className="map-file-button">
              选择地图文件
              <input
                disabled={busy}
                aria-label="选择地图文件"
                type="file"
                accept=".mbtiles,.tif,.tiff,.json,.xml,.txt,.ovmap"
                onChange={(e) => {
                  file(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <details>
            <summary>支持的格式与填写说明</summary>
            <p>
              在线：XYZ / TMS、Web Mercator WMTS 瓦片地址、WMS
              GetMap（EPSG:3857，BBOX 使用 {'{bbox-epsg-3857}'}）、栅格
              TileJSON、MOBAC customMapSource XML。配置网址需服务允许跨域访问。
            </p>
            <p>
              离线：栅格 MBTiles（PNG / JPEG / WebP）、8 位北向 GeoTIFF（WGS84 /
              Web Mercator / WGS84 UTM，最多 1600 万像素）。单文件 ≤64
              MB；GeoTIFF 保存最长边 2048 像素的显示副本。
            </p>
            <p>
              暂不支持奥维加密二维码 / .ovmap、矢量瓦片、GCJ-02 / BD-09
              图源。二维码识别后仍需检查格式。离线文件只保存在当前设备，在线图源由提供方负责覆盖、授权和可用性。
            </p>
          </details>
        </>
      )}
      {step === 'camera' && (
        <QrCamera onRead={qr} onClose={() => setStep('add')} />
      )}
      {step === 'preview' && (
        <>
          <p>已识别 {pending.length} 个地图，确认后保存到本机并切换。</p>
          {pending.map(({ draft, blob }, i) => (
            <div className="map-source-preview" key={i}>
              <strong>{draft.name}</strong>
              <p>
                {draft.format} · {blob ? '离线' : '在线'} · {draft.minzoom}–
                {draft.maxzoom} 级
              </p>
              {draft.tiles && (
                <p className="map-source-url">
                  {new URL(draft.tiles[0]).hostname} ·{' '}
                  {draft.scheme?.toUpperCase()}
                </p>
              )}
              {draft.bounds && (
                <p>范围：{draft.bounds.map((v) => v.toFixed(4)).join(', ')}</p>
              )}
              {draft.detail && <p>{draft.detail}</p>}
              <p>{draft.attribution}</p>
            </div>
          ))}
          <p className="map-source-hint">
            在线地图须使用 WGS84 / Web Mercator
            瓦片。识别配置成功不代表服务已连通。
          </p>
          <div className="map-source-actions">
            <button
              disabled={busy}
              onClick={() => {
                setPending([]);
                setStep('add');
              }}
            >
              返回修改
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const added = await sources.add(pending);
                  if (added.bounds) onFocus(added.bounds);
                  setPending([]);
                  setInput('');
                  setName('');
                  setStep('list');
                })
              }
            >
              确认添加并使用
            </button>
          </div>
        </>
      )}
      {busy && (
        <p role="status">
          正在读取地图… <button onClick={cancel}>取消读取</button>
        </p>
      )}
      {error && (
        <p ref={alert} className="map-source-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
