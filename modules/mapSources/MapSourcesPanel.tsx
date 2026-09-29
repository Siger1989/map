import { useEffect, useRef, useState } from 'react';
import type { useMapSources } from './useMapSources';
import {
  MAX_CONFIG_BYTES,
  MAX_FILE_BYTES,
  MAX_MAPS,
  type Bounds,
  type MapDraft,
} from './types';
import { parseMapConfig, resolveMapInput } from './online';
import { inspectOffline } from './offlineClient';
import { readQr } from './qr';
import { QrCamera } from './QrCamera';
import { ROUTE_QR_PREFIX } from '../routeShare/qrCodec';
import { basemapConfiguration } from '../cartography/basemaps';
import './mapSources.css';
import { FreeMapLibrary } from './FreeMapLibrary';
import { TiandituHelp } from './TiandituHelp';
import { TiandituSources } from '../cartography/TiandituSources';
import type { LayerSettings } from '../map/types';
import { usesSentinel } from '../cartography/sentinel';
import { RasterDatumChoice } from './RasterDatumChoice';
import { defaultRasterDatum } from './sourceDatum';
import { SavedMapSources } from './SavedMapSources';
import { parseOvmap } from './ovmap';
import { existingMapIndexes } from './importReview';
import { getMapSourcesSessionState, mapSourcesBrowseScrollToRestore, mapSourcesBrowseStepToRestore, rememberMapSourcesBrowseScroll, rememberMapSourcesBrowseStep, updateMapSourcesSessionState, type MapSourcesStep, type SourceCategory } from './sessionState';

type Pending = { draft: MapDraft; blob?: Blob };
export type MapSourcesNavigation = {
  title: string;
  label: string;
  onClick: () => void;
  disabled: boolean;
};
export function MapSourcesPanel({
  sources,
  builtin,
  onBuiltin,
  onFocus,
  onNavigation,
  onRouteQr,
  incomingFile,
  onIncomingConsumed,
  settings, onSettings, onOffline,
}: {
  sources: ReturnType<typeof useMapSources>;
  builtin: 'terrain' | 'detail' | 'latest';
  onBuiltin: (id: 'terrain' | 'detail' | 'latest') => void;
  onFocus: (bounds: Bounds) => void;
  onNavigation?: (navigation: MapSourcesNavigation | null) => void;
  onRouteQr?: (text: string) => void;
  incomingFile?: File | null;
  onIncomingConsumed?: () => void;
  settings?: LayerSettings;
  onSettings?: (patch: Partial<LayerSettings>) => void;
  onOffline?: () => void;
}) {
  const [step, setStepState] = useState<MapSourcesStep>(() => mapSourcesBrowseStepToRestore());
  const setStep = (value: MapSourcesStep) => {
    rememberMapSourcesBrowseStep(value);
    setStepState(value);
  };
  const currentStep = useRef(step);
  currentStep.current = step;
  const [input, setInput] = useState(''),
    [name, setName] = useState('');
  const [scheme, setScheme] = useState('xyz');
  const [pending, setPending] = useState<Pending[]>([]);
  const [category, setCategoryState] = useState<SourceCategory>(() => getMapSourcesSessionState().category ?? (sources.selected ? 'saved' : 'builtin'));
  const setCategory = (value: SourceCategory) => {
    updateMapSourcesSessionState({ category: value });
    setCategoryState(value);
  };
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [duplicates, setDuplicates] = useState<Set<number>>(new Set());
  const [skipped, setSkipped] = useState<{ name: string; reason: string }[]>([]);
  const [previewPage, setPreviewPage] = useState(0);
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const domestic = basemapConfiguration().domestic;
  const sentinelDownloadPending = !sources.selected && !!settings && usesSentinel(settings);
  const work = useRef<AbortController | null>(null);
  const root = useRef<HTMLElement>(null);
  const alert = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    onNavigation?.(
      step === 'list'
        ? null
        : {
            title:
              step === 'library' ? '公共图源库' : step === 'add'
                ? '添加地图'
                : step === 'preview'
                  ? '图源预览'
                  : '扫描二维码',
            label: step === 'add' || step === 'library' ? '返回图源列表' : '返回添加地图',
            disabled: step === 'preview' && busy,
            onClick: () => {
              work.current?.abort();
              work.current = null;
              setBusy(false);
              setError('');
              setPending([]);
              setStep(step === 'add' || step === 'library' ? 'list' : 'add');
            },
          },
    );
  }, [step, busy, onNavigation]);
  useEffect(() => () => onNavigation?.(null), [onNavigation]);
  useEffect(() => {
    const scroller = root.current?.closest('.dock-content');
    if (!scroller) return;
    const restore = mapSourcesBrowseScrollToRestore(step, sources.ready);
    if (restore !== null) scroller.scrollTop = restore;
    else if (step !== 'list') scroller.scrollTop = 0;
  }, [step, sources.ready]);
  useEffect(() => {
    const scroller = root.current?.closest('.dock-content');
    if (!scroller) return;
    const saveScroll = () => rememberMapSourcesBrowseScroll(currentStep.current, scroller.scrollTop);
    scroller.addEventListener('scroll', saveScroll, { passive: true });
    return () => {
      saveScroll();
      scroller.removeEventListener('scroll', saveScroll);
    };
  }, []);
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
    const repeated = existingMapIndexes(items.map(item => item.draft), sources.maps);
    setPending(items);
    setDuplicates(repeated);
    setPicked(new Set(items.map((_, i) => i).filter(i => !repeated.has(i)).slice(0, Math.max(0, MAX_MAPS - sources.maps.length))));
    setPreviewPage(0);
    setStep('preview');
  };
  const openAdd = () => { setError(''); setSkipped([]); setStep('add'); };
  const readInput = () =>
    run(async (signal) => {
      setSkipped([]);
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
      setSkipped([]);
      if (/\.(mbtiles|tiff?)$/i.test(selected.name)) {
        if (selected.size > MAX_FILE_BYTES)
          throw new Error('离线地图单个文件不能超过 64 MB，请先切片或缩小范围');
        const result = await inspectOffline(selected, signal);
        if (!signal.aborted) preview([result]);
      } else if (/\.ovmap$/i.test(selected.name)) {
        if (selected.size > MAX_CONFIG_BYTES) throw new Error('图源配置不能超过 1 MB');
        const result = parseOvmap(new Uint8Array(await selected.arrayBuffer()));
        if (!signal.aborted) {
          setSkipped(result.skipped);
          preview(result.drafts.map(draft => ({ draft })));
        }
      } else if (/\.(json|xml|txt)$/i.test(selected.name)) {
        if (selected.size > MAX_CONFIG_BYTES)
          throw new Error('图源配置不能超过 1 MB');
        const text = await selected.text();
        if (!signal.aborted)
          preview(parseMapConfig(text).map((draft) => ({ draft })));
      } else
        throw new Error(
          '此处支持 OVMAP、MBTiles、GeoTIFF、JSON / XML / TXT 配置；路线文件请到“路线”或“收藏”导入',
        );
    });
  };
  useEffect(() => {
    if (!incomingFile || !sources.ready) return;
    file(incomingFile);
    onIncomingConsumed?.();
  }, [incomingFile, sources.ready, onIncomingConsumed]);
  const qr = (text: string) => {
    if (text.startsWith(ROUTE_QR_PREFIX) && onRouteQr) {
      onRouteQr(text);
      return;
    }
    setInput(text);
    setName('');
    setStep('add');
    setError('已识别二维码，请检查内容，再点“识别并预览”');
  };
  return (
    <section ref={root} className="map-sources" data-step={step} data-category={category} aria-label="地图图源管理">
      {step === 'list' && <>
        <div className="map-source-tabs" role="group" aria-label="图源分类">
          <button aria-pressed={category === 'builtin'} onClick={() => setCategory('builtin')}>内置</button>
          <button aria-pressed={category === 'saved'} onClick={() => setCategory('saved')}>我的图源{sources.maps.length ? ` · ${sources.maps.length}` : ''}</button>
          <button onClick={() => { setError(''); setStep('library'); }}>公共库</button>
        </div>
        <p className="map-source-current">当前：{sources.source?.name ?? (settings?.satelliteProvider === 'tianditu' ? '天地图' : builtin === 'detail' ? 'Sentinel-2 2025' : builtin === 'latest' ? '最新云况' : '地形地图')}</p>
        {category === 'saved' && <SavedMapSources maps={sources.maps} selected={sources.selected} ready={sources.ready} busy={busy}
          onAdd={openAdd} onRemove={id => void run(async () => { await sources.remove(id); })}
          onSelect={map => { sources.select(map.id); if (map.bounds) onFocus(map.bounds); }} />}
        {category === 'saved' && settings && onSettings && <details className="map-source-settings"><summary>坐标校正与下载</summary>
          <RasterDatumChoice settings={settings} selected={sources.selected} image={sources.source?.kind === 'image'} defaultDatum={defaultRasterDatum(sources.source)} onChange={onSettings} onError={setError}/>
          {onOffline && <button onClick={onOffline}>下载当前范围</button>}
        </details>}
        {sources.status && <p role="status">{sources.status}</p>}
      </>}
      {(step === 'list' || step === 'library') && (
        <>
          {step === 'list' && category === 'builtin' && (domestic && settings && onSettings ? <TiandituSources active={!sources.selected} settings={settings} onChange={onSettings}/> : <div className="map-source-builtins" aria-label="内置图源">
            {(
              [
                ['terrain', domestic ? '天地图矢量' : '地形地图'],
                ['detail', 'Sentinel-2 2025'],
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
          </div>)}
          {step === 'list' && category === 'builtin' && settings && onSettings && <RasterDatumChoice settings={settings}
            selected={sources.selected} image={sources.source?.kind === 'image'} onChange={onSettings} onError={setError} />}
          {step === 'list' && category === 'builtin' && <div className="map-source-actions">{onOffline && <button disabled={sentinelDownloadPending} onClick={onOffline}>{sentinelDownloadPending?'区域下载待接入':'下载当前范围'}</button>}<button disabled={!sources.ready} onClick={openAdd}>导入图源</button></div>}
          {step === 'library' && <>
          {!onNavigation && <button onClick={()=>setStep('list')}>返回图源选择</button>}
          <FreeMapLibrary
            selected={sources.selected}
            onSelect={sources.select}
            onFocus={onFocus}
          />
          <button className="map-source-add" disabled={!sources.ready} onClick={openAdd}>导入自己的图源</button>
          {domestic ? <small className="map-source-hint">天地图已配置 · 含中文注记 · <a href="https://lbs.tianditu.gov.cn/server/MapService.html" target="_blank" rel="noreferrer">图层说明</a></small> : <TiandituHelp />}
          </>}
        </>
      )}
      {step === 'add' && (
        <>
          <div className="map-source-import-entry">
            <label className="map-file-button">
              导入地图文件
              <input
                disabled={busy}
                aria-label="导入地图文件"
                type="file"
                accept=".mbtiles,.tif,.tiff,.json,.xml,.txt,.ovmap"
                onChange={(e) => {
                  file(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </label>
            <small>奥维 OVMAP 合集 / 通用配置 / 离线影像</small>
          </div>
          <div className="map-source-actions">
            {!onNavigation && (
              <button
                onClick={() => {
                  cancel();
                  setStep('list');
                  setError('');
                }}
              >
                返回列表
              </button>
            )}
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
          <details className="map-source-manual" open={input.length > 0 || undefined}>
          <summary>粘贴图源地址 / 手动填写</summary>
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

          </div>
          </details>
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
              奥维 OVMAP 按可识别配置导入；不支持的条目会说明原因。加密二维码、矢量瓦片和百度专用瓦片矩阵暂不支持。文件只保存在当前设备，在线服务的覆盖与可用性由提供方决定。
            </p>
          </details>
        </>
      )}
      {step === 'camera' && (
        <QrCamera onRead={qr} onClose={() => setStep('add')} />
      )}
      {step === 'preview' && (
        <>
          <p role="status">识别 {pending.length + skipped.length} 项 · 可导入 {pending.length - duplicates.size} 项 · 已选 {picked.size}
            {duplicates.size > 0 ? ` · 重复 ${duplicates.size} 项` : ''}
            {skipped.length > 0 ? ` · 不支持 ${skipped.length} 项` : ''}</p>
          {pending.length > 0 && <div className="map-source-actions">
            <button disabled={busy} onClick={() => setPicked(new Set(pending.map((_, i) => i).filter(i => !duplicates.has(i)).slice(0, Math.max(0, MAX_MAPS - sources.maps.length))))}>全选可导入</button>
            <button disabled={busy || !picked.size} onClick={() => setPicked(new Set())}>清空选择</button>
          </div>}
          {pending.slice(previewPage * 4, previewPage * 4 + 4).map(({ draft, blob }, offset) => {
            const index = previewPage * 4 + offset;
            return <label className="map-source-preview-choice" key={index}>
              <input type="checkbox" checked={picked.has(index)} disabled={busy || duplicates.has(index)} aria-label={`导入 ${draft.name}`}
                onChange={event => { const next = new Set(picked); if (event.target.checked) next.add(index); else next.delete(index); setPicked(next); }} />
              <span><strong>{draft.name}</strong><small>{draft.format} · {blob ? '离线' : '在线'} · {draft.minzoom}–{draft.maxzoom} 级{duplicates.has(index) ? ' · 已有或重复' : ''}</small></span>
            </label>;
          })}
          {pending.length > 4 && <nav className="map-source-pages" aria-label="导入预览分页">
            <button disabled={busy || previewPage === 0} onClick={() => setPreviewPage(page => page - 1)}>上一页</button>
            <span>{previewPage + 1} / {Math.ceil(pending.length / 4)}</span>
            <button disabled={busy || (previewPage + 1) * 4 >= pending.length} onClick={() => setPreviewPage(page => page + 1)}>下一页</button>
          </nav>}
          {skipped.length > 0 && <details className="map-source-skipped"><summary>查看 {skipped.length} 项未导入原因</summary>
            {skipped.map((item, i) => <p key={i}><strong>{item.name}</strong>：{item.reason}</p>)}
          </details>}
          <p className="map-source-hint">配置仅保存本机；确认后使用首个勾选图源。识别成功不代表服务已连通。</p>
          {picked.size > MAX_MAPS - sources.maps.length && <p role="alert">本机还可保存 {Math.max(0, MAX_MAPS - sources.maps.length)} 项，请减少勾选。</p>}
          <div className="map-source-actions">
            {!onNavigation && (
              <button
                disabled={busy}
                onClick={() => {
                  setPending([]);
                  setStep('add');
                }}
              >
                返回修改
              </button>
            )}
            <button
              disabled={busy || picked.size === 0 || picked.size > MAX_MAPS - sources.maps.length}
              onClick={() =>
                void run(async () => {
                  const added = await sources.add(pending.filter((_, i) => picked.has(i) && !duplicates.has(i)));
                  if (added.bounds) onFocus(added.bounds);
                  setPending([]);
                  setInput('');
                  setName('');
                  setCategory('saved');
                  setStep('list');
                })
              }
            >
              导入已选 {picked.size} 项
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
