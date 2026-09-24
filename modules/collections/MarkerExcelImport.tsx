import { useRef, useState } from 'react';
import { annotationSpreadsheet } from '../annotations/spreadsheet';
import {
  markerSpreadsheetRows,
  planMarkerSpreadsheet,
  type MarkerSpreadsheetPlan,
} from '../annotations/spreadsheetImport';
import { collectData } from '../outdoor/exchange';
import { saveWorkbench } from './workbenchStore';
import { deliverFile } from '../files/delivery';
import { XLSX_MIME } from '../files/spreadsheet';
import type { Transfer } from '../outdoor/exchange';
import './markerExcelImport.css';

export function MarkerExcelImport({ onBack, onClose, embedded = false }: {
  onBack: () => void;
  onClose: () => void;
  embedded?: boolean;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [filename, setFilename] = useState('');
  const [plan, setPlan] = useState<MarkerSpreadsheetPlan | null>(null);
  const [undo, setUndo] = useState<{ before: Transfer; after: Transfer } | null>(null);
  const [message, setMessage] = useState('');
  const read = async (file: File) => {
    setLoading(true);
    setPlan(null);
    setUndo(null);
    setFilename(file.name);
    setMessage('');
    try {
      if (!/\.xlsx$/i.test(file.name)) throw new Error('请选择 .xlsx 标记表');
      const rows = markerSpreadsheetRows(new Uint8Array(await file.arrayBuffer()));
      setPlan(planMarkerSpreadsheet(rows, collectData()));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Excel 读取失败');
    } finally {
      setLoading(false);
    }
  };
  const apply = () => {
    if (!plan || plan.issues.length || (!plan.added && !plan.updated)) return;
    try {
      const after = saveWorkbench(plan.before, plan.after);
      setUndo({ before: plan.before, after });
      setMessage(`已新增 ${plan.added} 个、更新 ${plan.updated} 个标记`);
      setPlan(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '导入失败，原数据已保留');
    }
  };
  const restore = () => {
    if (!undo) return;
    try {
      saveWorkbench(undo.after, undo.before);
      setUndo(null);
      setMessage('已撤销本次 Excel 导入');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销失败，请检查收藏是否已变化');
    }
  };
  const template = async () => {
    try {
      setMessage(await deliverFile(new File(
        [new Uint8Array(annotationSpreadsheet([]))],
        'Shantu-markers-template.xlsx',
        { type: XLSX_MIME },
      ), false));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '模板保存失败');
    }
  };
  return <div className="collection-workbench marker-excel-import" aria-label="导入 Excel 标记">
    <section className="workbench-collections">
      {!embedded && <header className="workbench-heading">
        <button onClick={onBack}>‹ 返回</button>
        <div><strong>导入标记 Excel</strong></div>
        <button aria-label="关闭收藏" onClick={onClose}>关闭 ×</button>
      </header>}
      <div className="marker-excel-content">
        <p>每行一个点：经度（WGS84）、纬度（WGS84）、名称、备注；后续列写“属性：条目名”。ID 由导出自动填写，手建表可留空。</p>
        <div className="marker-excel-actions">
          <button disabled={loading} onClick={() => picker.current?.click()}>{loading ? '读取中…' : '选择 XLSX'}</button>
          <button disabled={loading} onClick={() => void template()}>下载空白模板</button>
          <input ref={picker} type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" aria-label="选择标记 Excel 文件" onChange={event => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void read(file);
          }} />
        </div>
        {filename && <strong className="marker-excel-filename" title={filename}>{filename}</strong>}
        {plan && <div className="marker-excel-preview" aria-label="Excel 导入预览">
          <strong>新增 {plan.added} · 更新 {plan.updated} · 不变 {plan.unchanged} · 错误 {plan.issues.length}</strong>
          <p>按 ID 优先匹配；没有 ID 时按六位小数坐标匹配。空白条目不删除已有内容，其他标记字段和照片保留。</p>
          {plan.examples.map(item => <div key={item.row}>第 {item.row} 行 · {item.action} · {item.name}</div>)}
          {plan.issues.slice(0, 12).map(item => <div className="marker-excel-error" key={item.row}>第 {item.row} 行 · {item.message}</div>)}
          {plan.issues.length > 12 && <p>还有 {plan.issues.length - 12} 行错误未列出。</p>}
          {!!plan.issues.length && <p>请修正错误行后重新选择文件；本批尚未写入。</p>}
        </div>}
        {message && <p role="status">{message}</p>}
      </div>
      {(plan || undo) && <footer className="marker-excel-footer">
        {plan && <><button disabled={!!plan.issues.length || (!plan.added && !plan.updated)} onClick={apply}>确认导入</button><button onClick={() => setPlan(null)}>取消</button></>}
        {undo && <button onClick={restore}>撤销本次导入</button>}
      </footer>}
    </section>
  </div>;
}
