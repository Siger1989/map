import { useEffect, useState } from 'react';
import { decodeCad } from './decoder';
import type { CadDecoded } from './types';
import { CAD_CHANGED, readCadDocuments, syncCadDocuments, replaceCadDocuments, type CadDocument } from './storage';
import { projectCad, cadToTransfer } from './project';
import { CrsSelector } from '../coordinates/CrsSelector';
import { detectCrs, readActiveProjectCrs, fromWgs84, type ProjectCrs } from '../coordinates';
import { mergeData } from '../dataTransfer/storage';
import type { Transfer } from '../dataTransfer/types';
import './cad.css';

const empty: Transfer = { format: 'guanyun-backup', version: 1, tracks: [], annotations: [], favorites: [] };
const MAX_CAD_FILE_BYTES = 20 * 1024 * 1024;
const ENTITY_BATCH_SIZE = 200;
function fileBase64(file: File): Promise<string> { return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).split(',')[1]); r.onerror = () => reject(new Error('无法读取 CAD 原文件')); r.readAsDataURL(file); }); }
function coordinates(doc: CadDocument): [number,number][] {
  return doc.mapFeatures.flatMap(f => f.geometry.type === 'Point' ? [[f.geometry.coordinates[0], f.geometry.coordinates[1]] as [number,number]] : f.geometry.type === 'LineString' ? f.geometry.coordinates.map(p => [p[0],p[1]] as [number,number]) : f.geometry.coordinates.flat().map(p => [p[0],p[1]] as [number,number]));
}
function focus(doc: CadDocument) { window.dispatchEvent(new CustomEvent('shantu-cad-focus', { detail: coordinates(doc) })); }

export function CadPanel({ onImported }: { onImported?: (data: Transfer) => void }) {
  const [documents, setDocuments] = useState<CadDocument[]>([]);
  const [pending, setPending] = useState<{ decoded: CadDecoded; base64: string; id: string } | null>(null);
  const [source, setSource] = useState<ProjectCrs | null>(null);
  const [axis, setAxis] = useState<'xy'|'yx'>('xy');
  const [scale, setScale] = useState('1');
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [selectedDoc, setSelectedDoc] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [layer, setLayer] = useState('');
  const [entityDisplayLimit, setEntityDisplayLimit] = useState(ENTITY_BATCH_SIZE);
  const [preview, setPreview] = useState<CadDocument | null>(null);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void readCadDocuments().then(d => { if (alive) setDocuments(d); }).catch(e => { if (alive) setMessage(e.message); }); };
    refresh(); window.addEventListener(CAD_CHANGED, refresh);
    return () => { alive = false; window.removeEventListener(CAD_CHANGED, refresh); };
  }, []);
  const read = async (file?: File) => {
    if (!file || busy) return;
    if (file.size > MAX_CAD_FILE_BYTES) { setPending(null); setPreview(null); setMessage('CAD 文件不得超过 20 MiB；请先在 CAD 软件中裁剪或拆分后再导入。'); return; }
    setBusy(true); setMessage('正在本机解码 CAD…'); setPending(null); setPreview(null);
    try {
      const bytes = await file.arrayBuffer();
      const decoded = await decodeCad(bytes, file.name);
      const digest = await crypto.subtle.digest('SHA-256', bytes);
      const id = 'cad-' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2,'0')).join('');
      setPending({ decoded, base64: await fileBase64(file), id });
      setSource(detectCrs(decoded.crsHint)); setScale('1'); setAxis('xy');
      setMessage(decoded.crsHint ? `文件声明坐标系：${decoded.crsHint}` : '文件没有可识别的坐标系，请明确选择原坐标系后预览。');
    } catch (e) { setMessage(e instanceof Error ? e.message : 'CAD 读取失败'); }
    finally { setBusy(false); }
  };
  const prepare = () => {
    try {
      if (!pending || !source) throw new Error('请先指定文件原坐标系，不能从坐标数值猜测。');
      const unitScale = Number(scale), active = readActiveProjectCrs();
      const mapFeatures = projectCad(pending.decoded, source, active, axis, unitScale);
      setPreview({ ...pending.decoded, id: pending.id, sourceBase64: pending.base64, sourceCrs: source, mapFeatures, visible: true, createdAt: Date.now(), axisOrder: axis, unitScale });
      const first = mapFeatures[0]?.geometry;
      const p = first?.type === 'Point' ? first.coordinates : first?.type === 'LineString' ? first.coordinates[0] : first?.coordinates[0][0];
      setMessage(`${mapFeatures.length} 个图元已转换到 ${active.name}；地图显示使用经纬度。${p ? `首点经纬度 ${p[0].toFixed(6)}, ${p[1].toFixed(6)}；工程坐标 ${fromWgs84(p as [number,number], active).map(v=>v.toFixed(3)).join(', ')}` : ''}`);
    } catch (e) { setPreview(null); setMessage(e instanceof Error ? e.message : '坐标转换失败'); }
  };
  const save = async () => {
    if (!preview || busy) return;
    setBusy(true);
    try { await syncCadDocuments([preview]); focus(preview); setPending(null); setPreview(null); setMessage('CAD 参考图层已保存；原文件、原坐标和图层属性保留。'); onImported?.(empty); }
    catch (e) { setMessage(e instanceof Error ? e.message : 'CAD 保存失败'); }
    finally { setBusy(false); }
  };
  const doc = documents.find(d=>d.id===selectedDoc);
  const shown = doc?.mapFeatures.filter(f=>!layer || f.layer===layer) ?? [];
  const visibleEntities = shown.slice(0, entityDisplayLimit);
  const convert = () => {
    try {
      if (!doc || !selected.size) throw new Error('请先勾选要转成可编辑对象的图元');
      const data = cadToTransfer(doc.name, doc.mapFeatures.filter(f=>selected.has(f.id)));
      mergeData(data); setSelected(new Set()); setMessage('所选 CAD 图元已转成山兔可编辑对象，参考图层保留。'); onImported?.(data);
    } catch(e) { setMessage(e instanceof Error ? e.message : '转换失败'); }
  };
  return <details className="cad-panel"><summary>CAD 导入 / 参考图层 / 转可编辑对象</summary>
    <label className="cad-file">{busy ? '正在处理…' : '选择 DWG / DXF'}<input type="file" accept=".dwg,.dxf" disabled={busy} onChange={e=>{const f=e.target.files?.[0];e.target.value='';void read(f);}} /></label>
    <p className="route-note">本机解析常见二维图元，曲线离散显示；二进制 DXF 请另存 ASCII DXF。未支持的图元会提示，原文件随完整 JSON 保留。</p>
    {pending && <div className="cad-import-options">
      <strong>{pending.decoded.name} · {pending.decoded.features.length} 个图元</strong>
      <small>文件单位：{pending.decoded.units || '未声明'}。坐标系与单位必须按原图核对；本地独立坐标需先配准。</small>
      {!source && <button type="button" onClick={()=>setSource(readActiveProjectCrs())}>手动指定原坐标系</button>}
      {source && <CrsSelector id="cad-source-crs" label="CAD 原坐标系" value={source} onChange={value=>{setSource(value);setPreview(null);}} />}
      <label>坐标轴<select value={axis} onChange={e=>{setAxis(e.target.value as 'xy'|'yx');setPreview(null);}}><option value="xy">X=东坐标，Y=北坐标</option><option value="yx">X=北坐标，Y=东坐标</option></select></label>
      <label>原图单位→坐标系单位比例<input type="number" min="0.000001" step="any" value={scale} onChange={e=>{setScale(e.target.value);setPreview(null);}} /></label>
      <small>米→米填1，毫米→米填0.001；经纬度单位为度时填1。高程原值保留，不自动改变高程基准。</small>
      {pending.decoded.warnings.map((w,i)=><p className="route-note" key={i}>{w}</p>)}
      <div className="cad-actions"><button type="button" disabled={busy} onClick={prepare}>转换并预览坐标</button>{preview && <button type="button" disabled={busy} onClick={()=>void save()}>保存参考图层并查看</button>}<button type="button" onClick={()=>{setPending(null);setPreview(null);}}>取消</button></div>
    </div>}
    {documents.length>0 && <>
      <label>本机 CAD 图<select value={selectedDoc} onChange={e=>{setSelectedDoc(e.target.value);setSelected(new Set());setLayer('');setEntityDisplayLimit(ENTITY_BATCH_SIZE);}}><option value="">选择已导入图件</option>{documents.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      {doc && <>
        <div className="cad-actions"><button type="button" onClick={()=>{focus(doc);onImported?.(empty);}}>地图查看</button><button type="button" onClick={()=>void syncCadDocuments([{...doc,visible:!doc.visible}]).catch(e=>setMessage(e.message))}>{doc.visible?'隐藏图层':'显示图层'}</button><button type="button" onClick={()=>void replaceCadDocuments(documents.filter(d=>d.id!==doc.id)).then(()=>setSelectedDoc('')).catch(e=>setMessage(e.message))}>移除本机图件</button></div>
        <label>图层<select value={layer} onChange={e=>{setLayer(e.target.value);setEntityDisplayLimit(ENTITY_BATCH_SIZE);}}><option value="">全部图层</option>{doc.layers.map(l=><option key={l.name} value={l.name}>{l.name}</option>)}</select></label>
        <div className="cad-actions"><button type="button" onClick={()=>setSelected(new Set(shown.map(f=>f.id)))}>选择当前图层</button><button type="button" onClick={()=>setSelected(new Set())}>取消选择</button></div>
        <div className="cad-entities" aria-label="CAD 图元列表">{visibleEntities.map(f=><label key={f.id}><input type="checkbox" checked={selected.has(f.id)} onChange={e=>setSelected(old=>{const n=new Set(old);e.target.checked?n.add(f.id):n.delete(f.id);return n;})}/><span>{f.text || (f.layer + ' · ' + f.entityType)}<small>{f.id}</small></span></label>)}</div>
        {shown.length > visibleEntities.length && <button type="button" onClick={()=>setEntityDisplayLimit(limit=>Math.min(shown.length,limit+ENTITY_BATCH_SIZE))}>再显示 {Math.min(ENTITY_BATCH_SIZE,shown.length-visibleEntities.length)} 项（剩余 {shown.length-visibleEntities.length} 项）</button>}
        <button type="button" disabled={!selected.size} onClick={convert}>将选中 {selected.size} 个图元转为可编辑对象</button>
      </>}
    </>}
    {message && <p className="route-note" role="status">{message}</p>}
  </details>;
}
