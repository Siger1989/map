import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent } from 'react';
import { generateGeology } from './engine.ts';
import type { IndustryKind, IndustryResult } from './export';
import { downloadIndustryBundle, downloadIndustryTemplate, downloadPng, downloadSvg, rasterizeIndustrySvg } from './export';
import { IndustryDataTable } from './IndustryDataTable';
import './industry.css';

type KindState = { selectedFile?: File; successfulFile?: File; result?: IndustryResult; resultFilename?: string; png?: File; error?: string; notice?: string };
export type IndustryToolsState = { selectedKind: IndustryKind; byKind: Partial<Record<IndustryKind, KindState>> };
type StateUpdate = IndustryToolsState | ((current: IndustryToolsState) => IndustryToolsState);

export function createIndustryToolsState(): IndustryToolsState { return { selectedKind: 'section', byKind: {} }; }

const MODE_LABEL: Record<IndustryKind, string> = { section: '实测剖面', drill: '钻孔柱状图' };
type ZoomLevel = 'fit' | 100 | 200 | 400 | 800;
function svgOriginalWidth(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const width = Number.parseFloat(root.getAttribute('width') ?? '');
  if (Number.isFinite(width) && width > 0) return width;
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  return viewBox?.length === 4 && viewBox[2] > 0 ? viewBox[2] : 1000;
}

export function IndustryTools({ state, onStateChange }: { state: IndustryToolsState; onStateChange: (next: StateUpdate) => void }) {
  const kind = state.selectedKind;
  const data = state.byKind[kind] ?? {};
  const native = typeof window !== 'undefined' && !!window.GuanyunNative;
  const requestId = useRef(0);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<ZoomLevel>('fit');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [previewUrls, setPreviewUrls] = useState<{ main: string; detail: string }>({ main: '', detail: '' });
  const mainViewport = useRef<HTMLDivElement>(null);
  const detailViewport = useRef<HTMLDivElement>(null);
  const scrollAnchors = useRef({ mainX: 0, mainY: 0, detailX: 0, detailY: 0 });
  const result = data.result;
  const staleResult = !!result && !!data.selectedFile && data.successfulFile !== data.selectedFile;

  useEffect(() => () => { requestId.current++; }, []);
  useEffect(() => {
    if (!result) { setPreviewUrls({ main: '', detail: '' }); return; }
    const main = URL.createObjectURL(new Blob([result.svg], { type: 'image/svg+xml;charset=utf-8' }));
    const detail = result.detailSvg ? URL.createObjectURL(new Blob([result.detailSvg], { type: 'image/svg+xml;charset=utf-8' })) : '';
    setPreviewUrls({ main, detail });
    return () => { URL.revokeObjectURL(main); if (detail) URL.revokeObjectURL(detail); };
  }, [result]);
  useLayoutEffect(() => {
    const restore = (element: HTMLDivElement | null, x: number, y: number) => {
      if (!element) return;
      element.scrollLeft = x * Math.max(0, element.scrollWidth - element.clientWidth);
      element.scrollTop = y * Math.max(0, element.scrollHeight - element.clientHeight);
    };
    restore(mainViewport.current, scrollAnchors.current.mainX, scrollAnchors.current.mainY);
    restore(detailViewport.current, scrollAnchors.current.detailX, scrollAnchors.current.detailY);
  }, [zoom]);
  const update = (patch: Partial<KindState>, targetKind: IndustryKind = kind) => onStateChange(current => ({
    ...current,
    byKind: { ...current.byKind, [targetKind]: { ...(current.byKind[targetKind] ?? {}), ...patch } },
  }));
  const selectKind = (next: IndustryKind) => {
    requestId.current++;
    setBusy(false);
    setActionError('');
    onStateChange(current => ({ ...current, selectedKind: next }));
  };

  const runFile = async (file: File) => {
    const id = ++requestId.current;
    update({ selectedFile: file, error: '', notice: '' }, kind);
    setBusy(true);
    setActionError('');
    try {
      const output = await generateGeology(await file.arrayBuffer(), file.name, kind);
      if (requestId.current !== id) return;
      setZoom('fit');
      scrollAnchors.current = { mainX: 0, mainY: 0, detailX: 0, detailY: 0 };
      update({ selectedFile: file, successfulFile: file, result: output, resultFilename: file.name, png: undefined, error: '', notice: '校验完成，图件已生成。' }, kind);
    } catch (error) {
      if (requestId.current !== id) return;
      update({ selectedFile: file, error: error instanceof Error ? error.message : String(error), notice: '' }, kind);
    } finally {
      if (requestId.current === id) setBusy(false);
    }
  };

  const onFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) void runFile(file);
  };
  const action = async (run: () => Promise<string>) => {
    setActionBusy(true);
    setActionError('');
    try { update({ notice: await run() }, kind); }
    catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setActionBusy(false); }
  };
  const makePng = async () => {
    if (!result) return;
    setActionBusy(true); setActionError('');
    try {
      const png = await rasterizeIndustrySvg(result.svg, `${result.title || MODE_LABEL[kind]}.png`);
      update({ png, notice: `PNG 已生成（${png.size.toLocaleString()} 字节），由当前 SVG 主图重新栅格化。` });
      if (!window.GuanyunNative) await downloadPng(png);
      else update({ png, notice: 'PNG 已生成，可与 SVG、附表一并保存为图件包。' });
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setActionBusy(false); }
  };
  const saveBundle = async () => {
    if (!result) return;
    setActionBusy(true); setActionError('');
    try {
      const png = data.png ?? await rasterizeIndustrySvg(result.svg, `${result.title || MODE_LABEL[kind]}.png`);
      update({ png });
      update({ notice: await downloadIndustryBundle(result, png) });
    } catch (error) { setActionError(error instanceof Error ? error.message : String(error)); }
    finally { setActionBusy(false); }
  };
  const changeZoom = (level: ZoomLevel) => {
    const measure = (element: HTMLDivElement | null) => ({
      x: element ? element.scrollLeft / Math.max(1, element.scrollWidth - element.clientWidth) : 0,
      y: element ? element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight) : 0,
    });
    const main = measure(mainViewport.current), detail = measure(detailViewport.current);
    scrollAnchors.current = { mainX: main.x, mainY: main.y, detailX: detail.x, detailY: detail.y };
    setZoom(level);
  };
  const originalWidth = result ? svgOriginalWidth(result.svg) : 1000;
  const renderedWidth = zoom === 'fit' ? '100%' : `${Math.min(16_000, originalWidth * zoom / 100)}px`;

  return <main className="industry-tools" aria-label="行业工具离线出图">
    <div className="industry-mode-tabs" role="tablist" aria-label="图件类型">
      {(['section', 'drill'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={kind === value} onClick={() => selectKind(value)}>{MODE_LABEL[value]}</button>)}
    </div>
    <section className="industry-import-card" aria-label={`${MODE_LABEL[kind]}工作簿导入`}>
      <p>文件在本机处理。选择标准 Excel 工作簿后会自动校验并生成图件，不需要网络服务。</p>
      <label className="industry-file-button">{busy ? '正在校验并生成…' : data.selectedFile ? '重新导入标准 .xlsx' : '导入标准 .xlsx'}
        <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={onFile} />
      </label>
      <div className="industry-asset-actions">
        <button type="button" disabled={actionBusy} onClick={() => void action(() => downloadIndustryTemplate(kind))}>下载标准模板</button>
        <button type="button" disabled={actionBusy} onClick={() => void action(() => downloadIndustryTemplate(kind, true))}>下载示例工作簿</button>
      </div>
      {data.selectedFile && <p className="industry-file-name">当前文件：{data.selectedFile.name}</p>}
      {data.error && <p className="industry-error" role="alert">本次导入未通过：{data.error}{result && <span>；仍显示上次成功图件（来源：{data.resultFilename}）。</span>}</p>}
      {data.notice && <p className="industry-notice" role="status">{data.notice}</p>}
      {actionError && <p className="industry-error" role="alert">{actionError}{result && <span>；已生成的图件仍保留。</span>}</p>}
    </section>
    {result ? <section className="industry-result" aria-label="生成结果">
      <header className="industry-result-heading">
        <div><h3>{result.title || MODE_LABEL[kind]}</h3><p>来源：{data.resultFilename || '未记录文件名'}{staleResult ? ' · 当前展示上次成功结果' : ''}</p></div>
        <span>{kind === 'section' ? '矢量剖面' : '矢量钻孔柱状图'}</span>
      </header>
      {staleResult && <p className="industry-stale" role="status">当前选择尚未生成对应图件；下方仍保留此前成功结果，来源为 {data.resultFilename}。</p>}
      {result.issues.length > 0 && <details className="industry-issues">
        <summary>检查提示（{result.issues.length}）</summary>
        <ul>{result.issues.map((issue, index) => <li key={`${issue.code}-${index}`}><strong>{issue.severity === 'error' ? '错误' : issue.severity === 'warning' ? '提示' : issue.severity}</strong>：{issue.message}{issue.cells?.length ? `（${issue.cells.join('、')}）` : ''}</li>)}</ul>
      </details>}
      <div className="industry-view-tools">
        <div className="industry-zoom-controls" role="group" aria-label="矢量图缩放">
          {([['fit', '适宽'], [100, '100%'], [200, '200%'], [400, '400%'], [800, '800%']] as const).map(([level, label]) => <button key={level} type="button" aria-pressed={zoom === level} onClick={() => changeZoom(level)}>{label}</button>)}
        </div>
        <p className="industry-zoom-note">100% 按 SVG 原始像素宽度显示；可在图内双向滚动查看细节。</p>
        <button type="button" disabled={actionBusy || native} title={native ? 'SVG 包含在“保存图件包”中' : undefined} onClick={() => void action(() => downloadSvg(result.svg, `${result.title || MODE_LABEL[kind]}-主图.svg`))}>{native ? 'SVG已含在图件包' : '保存 SVG'}</button>
        <button type="button" disabled={actionBusy} onClick={() => void makePng()}>{native ? '生成 PNG' : '生成并保存 PNG'}</button>
        <button type="button" className="industry-primary" disabled={actionBusy} onClick={() => void saveBundle()}>{native ? '保存图件包' : '下载完整图件包'}</button>
      </div>
      <div ref={mainViewport} className="industry-svg-viewport" role="region" aria-label="图件矢量预览，可滚动查看" tabIndex={0}>
        {previewUrls.main && <img src={previewUrls.main} alt={`${result.title || MODE_LABEL[kind]}主图预览`} style={{ width: renderedWidth }} />}
      </div>
      {result.detailSvg && <details className="industry-detail-svg">
        <summary>查看详图 SVG</summary>
        <div ref={detailViewport} className="industry-svg-viewport" role="region" aria-label="详图矢量预览，可滚动查看" tabIndex={0}>{previewUrls.detail && <img src={previewUrls.detail} alt={`${result.title || MODE_LABEL[kind]}详图预览`} style={{ width: renderedWidth }} />}</div>
      </details>}
      <IndustryDataTable kind={kind} normalized={result.normalized} />
      <details className="industry-audit-details"><summary>校验与来源追溯摘要</summary><pre>{JSON.stringify({ source: result.audit.source, summary: result.audit.summary, audit: result.audit }, null, 2)}</pre></details>
    </section> : <p className="industry-empty-state">导入工作簿后，校验结果、图件和附表会显示在这里。</p>}
  </main>;
}
