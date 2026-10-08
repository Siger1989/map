import { useEffect, useRef, useState } from 'react';
import { MAX_SAVED_TRACKS } from '../tracks/drawing';
import { collectData, mergeData, summarizeSync, syncData } from './storage';
import { exportGPX, exportKML } from './xmlExport';
import { saveFile } from './download';
import { deliverFile } from '../files/delivery';
import { parseFiles, type ImportBatch } from './batchImport';
import { parseFile } from './fileImport';
import { validateTransfer } from './validation';
import type { ImportCoordinates } from './coordinateSystem';
import type { Transfer } from './types';
import { exportWorkspace, validateWorkspace, importWorkspace, summarizeWorkspace, type WorkspaceBackup } from './workspaceBackup';
import { CoordinateTransfer } from '../coordinates/CoordinateTransfer';
import { CadPanel } from '../cad/CadPanel';
import './transferSync.css';
export function TransferPanel({ importOnly = false, initialFiles, onImported }: {
  importOnly?: boolean;
  initialFiles?: File[];
  onImported?: (data: Transfer) => void;
}) {
  const importing = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const opened = useRef<File[] | undefined>(undefined);
  const [coordinates, setCoordinates] = useState<ImportCoordinates>('auto');
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const pending = batch?.data;
  const [syncPending, setSyncPending] = useState<{ data: Transfer; summary: ReturnType<typeof summarizeSync> } | null>(null);
  const [workspacePending, setWorkspacePending] = useState<WorkspaceBackup | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [loading, setLoading] = useState(false),
    [message, setMessage] = useState('');
  const act = (work: () => void) => {
    try {
      work();
      setMessage('操作完成');
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const read = async (files: File[]) => {
    if (importing.current || !files.length) return;
    importing.current = true;
    setLoading(true);
    setBatch(null);
    setSyncPending(null);
    setWorkspacePending(null);
    setMessage('');
    try {
      setBatch(await parseFiles(files, (file) => parseFile(file, coordinates)));
      setMessage('整批已校验，请确认导入内容');
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      importing.current = false;
      setLoading(false);
    }
  };
  const readSync = async (file?: File) => {
    if (!file || importing.current) return;
    importing.current = true;
    setSyncLoading(true);
    setSyncPending(null);
    setWorkspacePending(null);
    setBatch(null);
    setMessage('');
    try {
      if (!/\.json$/i.test(file.name)) throw new Error('请选择山兔 JSON 备份文件');
      if (file.size > 100 * 1024 * 1024) throw new Error('完整 JSON 文件超过 100 MB');
      const raw = JSON.parse(await file.text());
      if (raw?.format === 'shantu-workspace') {
        setWorkspacePending(validateWorkspace(raw));
        setMessage('完整工作区已校验，请确认载入；同 ID 覆盖，本机独有数据保留。');
        return;
      }
      const data = validateTransfer(raw);
      if (data.format !== 'guanyun-backup' || data.version !== 1)
        throw new Error('仅支持山兔 v1 JSON 备份');
      setSyncPending({ data, summary: summarizeSync(collectData(), data) });
      setMessage('同步文件已校验，请核对覆盖与新增数量');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '同步文件读取失败');
    } finally {
      importing.current = false;
      setSyncLoading(false);
    }
  };
  useEffect(() => {
    if (initialFiles?.length && opened.current !== initialFiles) {
      opened.current = initialFiles;
      void read(initialFiles);
    }
  }, [initialFiles]);
  useEffect(() => {
    if (loading || batch || message) feedback.current?.scrollIntoView({ block: 'nearest' });
  }, [loading, batch, message]);
  return (
    <section
      aria-label="数据导入导出"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void read(Array.from(event.dataTransfer.files));
      }}
    >
      <>
        <details className="import-coordinate-options">
        <summary>奥维文件坐标设置（普通 GPX / KML 无需修改）</summary>
        <label>
          奥维文件坐标系
          <select
            aria-label="奥维文件坐标系"
            value={coordinates}
            disabled={loading || syncLoading}
            onChange={(e) => {
              setCoordinates(e.target.value as ImportCoordinates);
              setBatch(null);
            }}
          >
            <option value="auto">未指定 · 普通GPX/KML按标准识别</option>
            <option value="cgcs2000">CGCS2000地理坐标（按奥维导出设置）</option>
            <option value="gcj02">GCJ02（转换为GPS坐标，近似）</option>
          </select>
        </label>
        <small>
          同批奥维文件须使用相同坐标系；未知时先核对导出设置。投影坐标需先转地理坐标。
        </small>
        </details>
        <label className="import-file">
          {loading ? '正在读取路线文件…' : '选择路线 / 收藏文件'}
          <input
            type="file"
            multiple
            accept=".gpx,.kml,.kmz,.ovkml,.ovkmz,.json,.geojson,.tcx,.fit,.csv,.tsv,.ovjsn,.ovobj"
            disabled={loading || syncLoading}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void read(files);
            }}
          />
        </label>
        <details>
          <summary>支持格式 / 奥维文件怎么导入</summary>
          <p className="route-note">可直接读取 GPX、KML / KMZ、OVKML / OVKMZ、TCX、FIT、GeoJSON、CSV / TSV、OVJSN、OVOBJ 和山兔 JSON 备份。CSV 按 WGS84 经纬度表头读取；OVOBJ 已接入 v105 的部分点线面结构，其他版本仍需适配。</p>
          <p className="route-note">奥维文件可在上方调整坐标系。OVJSN 优先读取对象自身坐标标志；OVOBJ 未确认基准时按原坐标预览。含 waylines.wpml 的无人机航线 KMZ 只导入航点连线，不导入飞行指令。</p>
        </details>
        <div ref={feedback} aria-live="polite" aria-atomic="true">
        {(message || loading) && <p role="status" className="route-note">{loading ? '正在校验文件，请稍候…' : message}</p>}
        {pending && (
          <div className="import-preview">
            {pending.importWarnings?.map((notice,i)=><p className="route-note" key={i}>{notice}</p>)}
            <details>
              <summary>{batch!.files.length}个文件通过校验</summary>
              {batch!.files.map((file, i) => (
                <p key={i} className="route-note">
                  {file.name} · {file.tracks}条轨迹 / {file.annotations}个标记
                </p>
              ))}
            </details>
            <p>
              {pending.tracks.length} 条轨迹 · {pending.annotations.length}{' '}
              个标记 · {pending.favorites.length} 条收藏
              {` · ${pending.areas?.length ?? 0} 个区域 · ${pending.sections?.length ?? 0} 个剖面 · ${pending.measurements?.length ?? 0} 条测量`}
            </p>
            <p className="route-note">
              合并到本机，保留已有数据；重复导入同一存档标识时合并。
            </p>
            <div className="outdoor-actions">
              <button onClick={() => {
                try {
                  const before = collectData();
                  const merged = mergeData(pending);
                  const oldTracks = new Set(before.tracks.map(t=>t.id)), oldFavorites = new Set(before.favorites.map(t=>t.id));
                  const wantedTracks = new Map(pending.tracks.map(t=>[t.id, JSON.stringify(t)]));
                  const wantedFavorites = new Map(pending.favorites.map(t=>[t.id, JSON.stringify(t)]));
                  const imported: Transfer = { ...pending,
                    tracks: merged.tracks.filter(t => !oldTracks.has(t.id) || (wantedTracks.has(t.id) && wantedTracks.get(t.id)===JSON.stringify(t))),
                    favorites: merged.favorites.filter(t => !oldFavorites.has(t.id) || (wantedFavorites.has(t.id) && wantedFavorites.get(t.id)===JSON.stringify(t))),
                  };
                  setBatch(null);
                  setMessage(`已导入 ${pending.tracks.length} 条轨迹、${pending.favorites.length} 条收藏、${pending.annotations.length} 个标记，可在收藏中查看`);
                  onImported?.(imported);
                } catch (error) { setMessage(error instanceof Error ? error.message : '导入失败，原数据已保留'); }
              }}>
                确认导入并显示
              </button>
              <button onClick={() => setBatch(null)}>取消</button>
            </div>
          </div>
        )}
        <details className="transfer-sync">
          <summary>完整 JSON · 手机 / 电脑互载</summary>
          <div className="transfer-sync-actions">
            <button
              type="button"
              disabled={syncLoading || loading}
              onClick={async () => {
                if (importing.current) return;
                importing.current = true; setSyncLoading(true); setMessage('正在收集完整工作区…');
                try { const data = await exportWorkspace(); const result = await deliverFile(new File([JSON.stringify(data)], 'Shantu-workspace.json', { type: 'application/json' }), false); setMessage(`${result}，可传到手机或电脑载入。`); }
                catch (error) { setMessage(error instanceof Error ? error.message : '完整 JSON 导出失败'); }
                finally { importing.current = false; setSyncLoading(false); }
              }}
            >一键导出完整 JSON</button>
            <label className="transfer-sync-file">
              {syncLoading ? '正在处理…' : '载入完整 JSON'}
              <input
                type="file"
                accept=".json,application/json"
                disabled={syncLoading || loading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  void readSync(file);
                }}
              />
            </label>
          </div>
          <p className="route-note">同 ID 以文件覆盖，本机独有数据保留。包含可编辑业务数据、已保存照片、CAD 原文件及图层、行业生图原始 Excel、工程坐标系、图源与布局；不含瓦片缓存、未保存的任务和未存入应用的照片原片。JSON 含私人资料及自定义图源授权信息，请自行保管。</p>
          {workspacePending && <div className="transfer-sync-preview">
            <strong>完整工作区载入预览</strong>
            <small>{(() => { const s=summarizeWorkspace(workspacePending); return `${s.routes} 条轨迹 · ${s.pins} 个标记 · ${s.photos} 张照片 · ${s.cadDocuments} 份 CAD · ${s.industryProjects} 份生图表格 · ${s.maps} 个图源 · ${s.areas} 个区域 · ${s.sections} 个剖面`; })()}</small>
            <small>同 ID 覆盖、接收端独有保留；设置采用文件内的值。两端使用同一备份格式。</small>
            <div className="transfer-sync-actions"><button type="button" disabled={syncLoading} onClick={async()=>{
              if(importing.current)return; importing.current=true;setSyncLoading(true);
              try { const data=await importWorkspace(workspacePending);setWorkspacePending(null);setMessage('完整工作区已载入；设置将在重新打开后全部应用。');onImported?.(data); }
              catch(e){setMessage(e instanceof Error?e.message:'载入失败');}
              finally{importing.current=false;setSyncLoading(false);}
            }}>确认载入并显示</button><button type="button" disabled={syncLoading} onClick={()=>setWorkspacePending(null)}>取消</button></div>
          </div>}
          {syncPending && (
            <div className="transfer-sync-preview">
              <strong>本次同步预览</strong>
              <span>新增 {Object.values(syncPending.summary.added).reduce((sum, count) => sum + count, 0)} 项 · 覆盖 {Object.values(syncPending.summary.overwritten).reduce((sum, count) => sum + count, 0)} 项</span>
              <small>
                轨迹 {syncPending.summary.added.tracks ?? 0}/{syncPending.summary.overwritten.tracks ?? 0} · 标记 {syncPending.summary.added.annotations ?? 0}/{syncPending.summary.overwritten.annotations ?? 0} · 收藏 {syncPending.summary.added.favorites ?? 0}/{syncPending.summary.overwritten.favorites ?? 0}
                {` · 区域 ${syncPending.summary.added.areas ?? 0}/${syncPending.summary.overwritten.areas ?? 0} · 剖面 ${syncPending.summary.added.sections ?? 0}/${syncPending.summary.overwritten.sections ?? 0} · 测点 ${syncPending.summary.added.sectionNotes ?? 0}/${syncPending.summary.overwritten.sectionNotes ?? 0} · 地区 ${syncPending.summary.added.regions ?? 0}/${syncPending.summary.overwritten.regions ?? 0} · 测量 ${syncPending.summary.added.measurements ?? 0}/${syncPending.summary.overwritten.measurements ?? 0} · 目录 ${syncPending.summary.added.groups ?? 0}/${syncPending.summary.overwritten.groups ?? 0}`}
              </small>
              <small>分类顺序：新增 / 覆盖</small>
              <div className="transfer-sync-actions">
                <button type="button" onClick={() => {
                  try {
                    syncData(syncPending.data);
                    const imported = syncPending.data;
                    setSyncPending(null);
                    setMessage('同步完成：同 ID 对象已覆盖，本机独有数据保留');
                    onImported?.(imported);
                  } catch (error) {
                    setMessage(error instanceof Error ? error.message : '同步失败，原数据已保留');
                  }
                }}>确认同步并显示</button>
                <button type="button" onClick={() => setSyncPending(null)}>取消</button>
              </div>
            </div>
          )}
        </details>
        <CoordinateTransfer onImported={data=>{mergeData(data);onImported?.(data);}} />
        <CadPanel onImported={onImported} />
        </div>
        <details open={!importOnly}>
        <summary>兼容旧版存档 / GPX / KML</summary>
        <div className="outdoor-actions">
          <button
            onClick={() =>
              act(() =>
                saveFile(
                  'Shantu-backup.json',
                  'application/json',
                  JSON.stringify(collectData(), null, 2),
                ),
              )
            }
          >
            旧版几何 JSON
          </button>
          <button
            onClick={() =>
              act(() =>
                saveFile(
                  'Shantu-tracks.gpx',
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
                  'Shantu-tracks.kml',
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
          JSON 保留标记属性、模型、区域、剖面测点、测量及路线分段颜色。GPX / KML
          交换点线；不含模型外观、KML
          原文件时间与海拔。可拖入文件，每批最多10个、合计32
          MB；任一失败则整批不写入。每个文件 ≤8 MB、每条轨迹 ≤6000 点，本机最多{' '}
          {MAX_SAVED_TRACKS} 条轨迹 / 20 条收藏 / 2000 个地点 / 80 个模型。
        </p>
        </details>
      </>
    </section>
  );
}
