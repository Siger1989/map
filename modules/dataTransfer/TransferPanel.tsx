import { useRef, useState } from 'react';
import { MAX_SAVED_TRACKS } from '../tracks/drawing';
import { collectData, mergeData } from './storage';
import { exportGPX, exportKML } from './xmlExport';
import { saveFile } from './download';
import { parseFiles, type ImportBatch } from './batchImport';
import { parseFile } from './fileImport';
import type { ImportCoordinates } from './coordinateSystem';
export function TransferPanel() {
  const importing = useRef(false);
  const [coordinates, setCoordinates] = useState<ImportCoordinates>('auto');
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const pending = batch?.data;
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
        <label>
          奥维文件坐标系
          <select
            aria-label="奥维文件坐标系"
            value={coordinates}
            disabled={loading}
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
        <label className="import-file">
          批量导入 GPX / KML / KMZ / OVKML / OVKMZ / JSON
          <input
            type="file"
            multiple
            accept=".gpx,.kml,.kmz,.ovkml,.ovkmz,.json"
            disabled={loading}
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              e.target.value = '';
              void read(files);
            }}
          />
        </label>
        {pending && (
          <div className="import-preview">
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
              <button
                onClick={() =>
                  act(() => {
                    mergeData(pending);
                    setBatch(null);
                  })
                }
              >
                确认合并
              </button>
              <button onClick={() => setBatch(null)}>取消</button>
            </div>
          </div>
        )}
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
            存档备份
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
      </>
      {(message || loading) && (
        <p role="status" className="route-note">
          {loading ? '校验文件…' : message}
        </p>
      )}
    </section>
  );
}
