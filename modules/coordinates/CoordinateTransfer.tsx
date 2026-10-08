import { useRef, useState } from 'react';
import { collectData } from '../dataTransfer/storage.ts';
import type { Transfer } from '../dataTransfer/types.ts';
import { deliverFile } from '../files/delivery.ts';
import {
  readActiveProjectCrs,
  resolveCrs,
  writeActiveProjectCrs,
  type ProjectCrs,
} from './index.ts';
import { exportCoordinateExchangeCsv, exportCoordinateExchangeJson, importCoordinateExchange } from './exchange.ts';
import { CrsSelector } from './CrsSelector.tsx';
import './coordinates.css';

type Props = { onImported: (data: Transfer) => void | Promise<void> };

export function CoordinateTransfer({ onImported }: Props) {
  const [currentCrs, setCurrentCrs] = useState<ProjectCrs>(() => readActiveProjectCrs());
  const [targetCrs, setTargetCrs] = useState<ProjectCrs>(() => readActiveProjectCrs());
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState<null | { fileName: string; result: ReturnType<typeof importCoordinateExchange> }>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const saveCurrentCrs = () => {
    try {
      writeActiveProjectCrs(currentCrs);
      setStatus(`已保存当前工程坐标系：${resolveCrs(currentCrs).name}`);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工程坐标系保存失败。');
      setStatus('');
    }
  };

  const exportFile = async (format: 'json' | 'csv') => {
    try {
      const data = collectData();
      const stamp = new Date().toISOString().slice(0, 10);
      if (format === 'json') {
        await deliverFile(new File([exportCoordinateExchangeJson(data, targetCrs)], `Shantu-coordinates-${stamp}.json`, { type: 'application/json;charset=utf-8' }), false);
      } else {
        await deliverFile(new File([exportCoordinateExchangeCsv(data, targetCrs)], `Shantu-coordinates-${stamp}.csv`, { type: 'text/csv;charset=utf-8' }), false);
      }
      setStatus(`已生成 ${format.toUpperCase()} 工程坐标交换文件（${resolveCrs(targetCrs).name}）。`);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工程坐标导出失败。');
      setStatus('');
    }
  };

  const loadFile = async (file?: File) => {
    if (!file) return;
    setPending(null);
    setError('');
    setStatus('');
    try {
      if (file.size > 20_000_000) throw new Error('工程坐标交换文件超过20MB限制。');
      const result = importCoordinateExchange(await file.text());
      setPending({ fileName: file.name, result });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工程坐标文件读取失败。');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const confirmImport = async () => {
    if (!pending) return;
    try {
      await onImported(pending.result.data);
      setStatus(`已提交 ${pending.result.featureCount} 个空间对象供合并：${pending.fileName}`);
      setPending(null);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '工程坐标导入失败。');
      setStatus('');
    }
  };

  return <details className="coordinate-transfer">
    <summary>工程坐标交换</summary>
    <div className="coordinate-transfer-body">
      <section>
        <h3>当前工程坐标系</h3>
        <CrsSelector id="exchange-project-crs" value={currentCrs} onChange={setCurrentCrs} label="工程坐标系" />
        <button type="button" onClick={saveCurrentCrs}>保存到此设备</button>
      </section>
      <section>
        <h3>导出目标坐标系</h3>
        <CrsSelector id="exchange-target-crs" value={targetCrs} onChange={setTargetCrs} label="导出坐标系" />
        <div className="coordinate-transfer-actions">
          <button type="button" onClick={() => exportFile('json')}>导出工程 JSON</button>
          <button type="button" onClick={() => exportFile('csv')}>导出交换 CSV</button>
        </div>
      </section>
      <section>
        <h3>导入工程坐标交换文件</h3>
        <p>导入会读取文件中显式 CRS 元数据并先预览，确认后才提交。接受山兔工程坐标交换 JSON/CSV；标准 GPX、KML、GeoJSON 仍按 WGS 84 处理。</p>
        <input ref={fileInput} type="file" accept=".json,.csv,application/json,text/csv" onChange={(event) => void loadFile(event.target.files?.[0])} />
        {pending && <div className="coordinate-preview">
          <p>文件：{pending.fileName}</p>
          <p>检测坐标系：{pending.result.crs.name}（{pending.result.crs.id}）</p>
          <p>空间对象：{pending.result.featureCount} 个。此交换格式保留点、线段分组和区域外环等几何信息，不包含完整业务属性或全部原始业务数据。</p>
          <div className="coordinate-transfer-actions">
            <button type="button" onClick={() => void confirmImport()}>确认导入</button>
            <button type="button" onClick={() => setPending(null)}>取消</button>
          </div>
        </div>}
      </section>
      <p>CSV 为山兔工程坐标交换格式，含 CRS、featureID、name、type、part、vertex、x、y、z 字段；不是通用 CAD CSV 规范。工程坐标不是标准 GeoJSON；标准 GPX/KML/GeoJSON 始终使用 WGS 84。CGCS2000 与 WGS 84 零平移为近似，不代表测绘级基准转换。</p>
      {(currentCrs.id === 'EPSG:4214' || currentCrs.id === 'EPSG:4610' || targetCrs.id === 'EPSG:4214' || targetCrs.id === 'EPSG:4610') && <p>北京54/西安80 跨基准转换需要经核实的本地三参数或七参数；未提供时会明确失败。</p>}
      {status && <p className="coordinate-success" role="status">{status}</p>}
      {error && <p className="coordinate-error" role="alert">{error}</p>}
    </div>
  </details>;
}
