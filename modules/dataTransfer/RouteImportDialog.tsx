import { TransferPanel } from './TransferPanel';
import type { Transfer } from './types';
import { useRouteDialogFocus } from '../tracks/useRouteDialogFocus';
import '../guidance/navigationStart.css';
import './routeImport.css';

export function RouteImportDialog({ files, error, status, onClose, onImported }: {
  files?: File[]; error?: string; status?: string; onClose: () => void; onImported: (data: Transfer) => void;
}) {
  const root = useRouteDialogFocus(onClose);
  return <div className="route-dialog-backdrop">
    <section ref={root} className="route-dialog route-import-dialog" role="dialog" aria-modal="true" aria-label="导入路线与收藏">
      <header><strong>导入路线与收藏</strong><button onClick={onClose}>关闭</button></header>
      {error && <p role="alert">{error}</p>}
      {status ? <p role="status">{status}</p> : <TransferPanel importOnly initialFiles={files} onImported={onImported} />}
      <small>普通路线≤8MB，CAD≤20MB，完整JSON≤100MB；先校验预览，再确认载入。</small>
    </section>
  </div>;
}
