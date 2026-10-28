import { useState } from 'react';
import { TransferPanel } from '../dataTransfer/TransferPanel';
import type { Transfer } from '../dataTransfer/types';
import { MarkerExcelImport } from './MarkerExcelImport';
import { createTaskMigrationBackup } from '../dataTransfer/taskMigration';
import { deliverFile } from '../files/delivery';
import type { Recording } from '../outdoor/recording';
import type { TrackDraft } from '../tracks/draft';
import './favoritesImport.css';

export function FavoritesImportPanel({ onClose, onImported, taskMigration }: {
  onClose: () => void;
  onImported: (data: Transfer) => void;
  taskMigration?: { draft: TrackDraft & { style?: import('../tracks/style').TrackStyle }; recording: Recording };
}) {
  const [mode, setMode] = useState<'files' | 'excel'>('files');
  const [migrationMessage, setMigrationMessage] = useState('');
  const [migrationBusy, setMigrationBusy] = useState(false);
  return <div className="favorites-import-backdrop">
    <section className="collection-workbench favorites-import" role="dialog" aria-modal="true" aria-label="导入收藏数据">
      <div className="workbench-collections">
      <header className="workbench-heading">
        <button onClick={onClose}>‹ 返回</button>
        <div><strong>导入收藏</strong></div>
        <button aria-label="关闭导入" onClick={onClose}>×</button>
      </header>
      <nav className="favorites-import-tabs" aria-label="导入类型">
        <button aria-pressed={mode === 'files'} onClick={() => setMode('files')}>路线、轨迹与备份</button>
        <button aria-pressed={mode === 'excel'} onClick={() => setMode('excel')}>标记 Excel</button>
      </nav>
      <div className="favorites-import-body">
        {mode === 'files'
          ? <>
            {taskMigration && <section className="transfer-sync">
              <strong>迁移未保存任务</strong>
              <p className="route-note">工作区备份不包含未保存的画线和原生记录检查点。此文件只包含当前草稿与暂停记录点；原文件授权不会跨应用迁移，需在新应用重新选择。</p>
              <button type="button" disabled={migrationBusy} onClick={async () => {
                if (migrationBusy) return;
                setMigrationBusy(true); setMigrationMessage('正在准备迁移文件…');
                try {
                  const data = createTaskMigrationBackup({
                    draft: { ...taskMigration.draft, name: '画线草稿' },
                    recording: taskMigration.recording,
                    fileReferences: [],
                  });
                  const result = await deliverFile(new File([JSON.stringify(data)], 'Shantu-paused-task-migration.json', { type: 'application/json' }), false);
                  setMigrationMessage(`${result}。请在新应用中选择此文件并确认导入。`);
                } catch (error) { setMigrationMessage(error instanceof Error ? error.message : '迁移文件导出失败'); }
                finally { setMigrationBusy(false); }
              }}>导出画线草稿 / 暂停记录</button>
              {migrationMessage && <p role="status" className="route-note">{migrationMessage}</p>}
            </section>}
            <TransferPanel importOnly filePickerStyle="button" onImported={data => { onImported(data); onClose(); }} />
          </>
          : <MarkerExcelImport embedded onBack={() => setMode('files')} onClose={onClose} />}
      </div>
      </div>
    </section>
  </div>;
}
