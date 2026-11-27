import { useEffect, useId, useRef, useState } from 'react';
import { Box, Download } from 'lucide-react';
import { deliverFile } from '../files/delivery';
import { plainText, type MapSource } from '../mapSources/types';
import { MapPanelHeader } from '../ui/MapPanelHeader';
import { TerrainPrintModelPreview } from './TerrainPrintModelPreview';
import { buildTerrainPrintFbx } from './buildFbx';
import { TerrainModelBaseEditor } from './TerrainModelBaseEditor';
import { canUseTerrainModelImagery, terrainModelImagery } from './modelImagery';
import {
  deleteTerrainPrintModel, listTerrainPrintModelMetas, loadTerrainPrintModel,
  type TerrainPrintRecord, type TerrainPrintRecordMeta,
} from './modelStore';
import './terrainLibrary.css';

export function TerrainPrintModels({ sources, initialId, onBack, onClose }: {
  sources: readonly MapSource[];
  initialId?: string | null;
  onBack: () => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const exportTask = useRef<AbortController | null>(null);
  useEffect(() => () => exportTask.current?.abort(), []);
  const [items, setItems] = useState<TerrainPrintRecordMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialId ?? null);
  const [record, setRecord] = useState<TerrainPrintRecord | null>(null);
  const [source, setSource] = useState<MapSource | null>(null);
  const sourceId = source?.id ?? '';
  const [texture, setTexture] = useState<Blob | null>(null);
  const [pending, setPending] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [baseEditing, setBaseEditing] = useState(false);
  const selection = record?.selection;
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    listTerrainPrintModelMetas().then(result => {
      if (active) setItems(result);
    }).catch(() => {
      if (active) setError('无法读取本机收藏的地形模型。');
    }).finally(() => {
      if (active) setLoaded(true);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    setRecord(null);
    loadTerrainPrintModel(selectedId).then(result => {
      if (!active) return;
      if (!result) throw new Error('此模型已移除。');
      setRecord(result);
    }).catch(err => {
      if (!active) return;
      setError(err instanceof Error ? err.message : '模型读取失败。');
      setSelectedId(null);
    });
    return () => { active = false; };
  }, [selectedId]);

  useEffect(() => {
    setTexture(null);
    if (!selection || !source) {
      setPending(false);
      return;
    }
    const controller = new AbortController();
    setPending(true);
    setError('');
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(35_000)]);
    terrainModelImagery(selection, source, signal).then(blob => {
      if (!controller.signal.aborted) setTexture(blob);
    }).catch(err => {
      if (!controller.signal.aborted) setError(signal.aborted ? '图源加载超时，请换一个图源。' : err instanceof Error ? err.message : '图源加载失败。');
    }).finally(() => {
      if (!controller.signal.aborted) setPending(false);
    });
    return () => controller.abort();
  }, [selection, source]);

  function viewItem(id: string) {
    setSelectedId(id);
    setError('');
    setMessage('');
  }

  function back() {
    if (baseEditing) { setBaseEditing(false); return; }
    if (!selectedId) { onBack(); return; }
    if (exporting) return;
    setSelectedId(null);
    setRecord(null);
    setSource(null);
    setTexture(null);
    setConfirmDelete(false);
    setMessage('');
    setError('');
  }

  async function removeModel() {
    if (!record || exporting) return;
    try {
      await deleteTerrainPrintModel(record.id);
      setItems(current => current.filter(item => item.id !== record.id));
      back();
    } catch { setError('无法删除此模型。'); }
  }

  async function exportFbx() {
    if (!record || exporting || pending || (sourceId && !texture)) return;
    const controller = new AbortController();
    exportTask.current = controller;
    setExporting(true);
    setMessage('');
    setError('');
    try {
      const content = texture ? {
        filename: texture.type === 'image/jpeg' ? 'terrain.jpg' : 'terrain.png',
        bytes: await texture.arrayBuffer(),
        mime: texture.type === 'image/jpeg' ? 'image/jpeg' as const : 'image/png' as const,
      } : undefined;
      const out = await buildTerrainPrintFbx(record.stl, record.options, content, controller.signal, record.trackColors);
      const file = new File([out], `Shantu-terrain-${record.selection.shape}-${Date.now()}.fbx`, { type: 'application/octet-stream' });
      setMessage(await deliverFile(file, false, controller.signal));
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'FBX 导出失败。');
    } finally {
      if (exportTask.current === controller) {
        exportTask.current = null;
        setExporting(false);
      }
    }
  }

  return <section className="terrain-library collection-workbench" aria-labelledby={titleId}
    data-app-back="45" onKeyDown={event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      back();
    }}>
    <MapPanelHeader title={record?.name ?? '模型预览'} titleId={titleId} onClose={onClose}
      closeLabel="关闭模型预览" back={{ label: baseEditing ? '返回模型预览' : selectedId ? '返回模型列表' : '返回收藏', onClick: back }} />
    <div className="terrain-library-content">
      {selectedId ? (record ? <>
        <TerrainPrintModelPreview record={record} texture={texture} />
        {baseEditing ? <TerrainModelBaseEditor record={record} onCancel={() => setBaseEditing(false)}
          onApplied={next => { setRecord(next); setBaseEditing(false); setMessage('底座已更新'); setError(''); }} /> :
        <div className="terrain-library-controls">
          <label>贴图图源
            <select value={sourceId} onChange={event => { setTexture(null); setSource(sources.find(item => item.id === event.target.value) ?? null); setError(''); setMessage(''); }}
              disabled={exporting}>
              <option value="">无贴图</option>
              {sources.filter(canUseTerrainModelImagery).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          </label>
          <small>高程来源 · {record.elevationSource === 'built-in' ? '地图自带 DEM' : 'NASA HMA 8 米'}</small>
          {source && <small>{plainText(source.attribution, source.name)}</small>}
          {pending && <p role="status">正在加载选区贴图…</p>}
          <button type="button" className="is-primary terrain-library-export" onClick={() => void exportFbx()}
            disabled={exporting || pending || Boolean(sourceId && !texture)}>
            <Download size={16} aria-hidden="true" />{exporting ? '正在导出…' : '导出 FBX'}
          </button>
          {confirmDelete ? <div className="terrain-library-delete">
            <button type="button" onClick={() => setConfirmDelete(false)}>取消</button>
            <button type="button" onClick={() => void removeModel()}>确认移除收藏模型</button>
          </div> : <div className="terrain-library-actions">
            <button type="button" onClick={() => { setMessage(''); setBaseEditing(true); }} disabled={exporting}>
              底座设置 · {record.options.rimMm > 0 ? '外围包边' : '平底'}
            </button>
            <button type="button" onClick={() => setConfirmDelete(true)} disabled={exporting}>移除收藏</button>
          </div>}
        </div>}
      </> : <p role="status">正在读取模型…</p>) : (
        loaded ? items.length ? <ul className="terrain-library-list">
          {items.map(item => <li key={item.id}><button type="button" onClick={() => viewItem(item.id)}>
            <Box size={18} aria-hidden="true" />
            <span>{item.name}</span>
            <small>{item.selection.shape === 'circle' ? '圆形' : '矩形'} · {item.options.widthMm} mm</small>
          </button></li>)}
        </ul> : <p>在「工具 → 地形打印」生成模型后，点「保存到收藏」。</p> : <p role="status">正在读取收藏…</p>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p className="terrain-library-error" role="alert">{error}</p>}
    </div>
  </section>;
}
