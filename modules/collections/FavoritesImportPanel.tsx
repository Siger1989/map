import { useState } from 'react';
import { TransferPanel } from '../dataTransfer/TransferPanel';
import type { Transfer } from '../dataTransfer/types';
import { MarkerExcelImport } from './MarkerExcelImport';
import './favoritesImport.css';

export function FavoritesImportPanel({ onClose, onImported }: {
  onClose: () => void;
  onImported: (data: Transfer) => void;
}) {
  const [mode, setMode] = useState<'files' | 'excel'>('files');
  return <div className="favorites-import-backdrop">
    <section className="collection-workbench favorites-import" role="dialog" aria-modal="true" aria-label="导入收藏数据">
      <div className="workbench-collections">
      <header className="workbench-heading">
        <button onClick={onClose}>‹ 返回</button>
        <div><strong>导入收藏</strong></div>
        <button aria-label="关闭收藏" onClick={onClose}>×</button>
      </header>
      <nav className="favorites-import-tabs" aria-label="导入类型">
        <button aria-pressed={mode === 'files'} onClick={() => setMode('files')}>路线、轨迹与备份</button>
        <button aria-pressed={mode === 'excel'} onClick={() => setMode('excel')}>标记 Excel</button>
      </nav>
      <div className="favorites-import-body">
        {mode === 'files'
          ? <TransferPanel importOnly onImported={data => { onImported(data); onClose(); }} />
          : <MarkerExcelImport embedded onBack={() => setMode('files')} onClose={onClose} />}
      </div>
      </div>
    </section>
  </div>;
}
