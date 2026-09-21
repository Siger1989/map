import { useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { collectData, type Transfer } from '../outdoor/exchange';
import { CATALOG_TYPES, type CatalogEntry } from './catalog';
import { withoutEntries } from './remove';
import { saveWorkbench } from './workbenchStore';
import './boxSelection.css';

/** Review only this map selection; reuse the archive transaction and conflict-safe undo. */
export function BoxSelectionResults({ entries, initialMessage, onClose, onReselect, onExport, storage = localStorage }: {
  entries: CatalogEntry[];
  initialMessage?: string;
  onClose: () => void;
  onReselect: () => void;
  onExport: (keys: string[]) => void;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
}) {
  const [excluded, setExcluded] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState(initialMessage ?? '');
  const [undo, setUndo] = useState<{ before: Transfer; after: Transfer } | null>(null);
  const chosen = useMemo(() => entries.filter(e => !excluded.includes(e.key)), [entries, excluded]);
  const remove = () => {
    if (!chosen.length) return;
    try {
      const before = collectData(storage);
      const after = saveWorkbench(before, withoutEntries(before, chosen.map(e => e.key)), storage);
      setUndo({ before, after });
      setConfirming(false);
      setMessage(`已删除 ${chosen.length} 项`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '删除失败，内容已保留');
    }
  };
  const restore = () => {
    if (!undo) return;
    try {
      saveWorkbench(undo.after, undo.before, storage);
      setUndo(null);
      setMessage('已撤销删除');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '撤销失败');
    }
  };
  return <section className="catalog-panel box-results" aria-label="框选结果">
    <header className="box-results-heading">
      <strong>{confirming ? `删除 ${chosen.length} 项？` : `框选结果 · ${chosen.length} 项`}</strong>
      <button aria-label="关闭框选结果，返回地图" onClick={onClose}><X size={16} /></button>
    </header>
    {confirming ? <>
      <p className="box-results-note">删除勾选的整个对象。未选内容及照片原件保留；删除后可在此撤销。</p>
      <div className="box-results-list">{chosen.map(e => <p key={e.key}>{e.name}</p>)}</div>
      <div className="box-results-actions"><button onClick={() => setConfirming(false)}>返回选择</button><button className="is-danger" disabled={!chosen.length} onClick={remove}>确认删除</button></div>
    </> : <>
      {!!entries.length && <div className="box-results-list" aria-label="本次框选对象">
        {entries.map(e => <label key={e.key}>
          <input type="checkbox" checked={!excluded.includes(e.key)} onChange={() => setExcluded(old => old.includes(e.key) ? old.filter(k => k !== e.key) : [...old, e.key])} />
          <span title={e.name}>{e.name}</span><small>{CATALOG_TYPES[e.kind]}</small>
        </label>)}
      </div>}
      {!entries.length && !message && <p className="box-results-note">本次框选中已没有对象，可以重新框选。</p>}
      <div className="box-results-actions">
        <button onClick={onReselect}>重新框选</button>
        {entries.length ? <><button disabled={!chosen.length} onClick={() => onExport(chosen.map(e => e.key))}>导出</button><button className="is-danger" disabled={!chosen.length} onClick={() => setConfirming(true)}>删除</button></> : <button onClick={onClose}>返回地图</button>}
        {undo && <button onClick={restore}>撤销删除</button>}
      </div>
    </>}
    {message && <p className="box-results-status" role="status">{message}</p>}
  </section>;
}
