import { useEffect, useState } from 'react';
import { collectData, DATA_CHANGED, type Transfer } from '../outdoor/exchange';
import { workbenchTransfer, workbenchTree } from './workbenchAdapter';
import { saveWorkbench } from './workbenchStore';
import type { WorkbenchItem } from './workbenchTree';

export function useWorkbenchData() {
  const [data, setData] = useState<Transfer | null>(null), [error, setError] = useState('');
  const [undo, setUndo] = useState<{ before: Transfer; after: Transfer } | null>(null);
  const reload = () => { try { setData(collectData()); setError(''); } catch { setData(null); setError('收藏存档读取失败，原数据已保留，暂不能整理。'); } };
  useEffect(() => { reload(); window.addEventListener(DATA_CHANGED,reload); window.addEventListener('storage',reload); return () => { window.removeEventListener(DATA_CHANGED,reload); window.removeEventListener('storage',reload); }; },[]);
  const commit = (tree: WorkbenchItem[]) => {
    if (!data) return false;
    try { const after = saveWorkbench(data, workbenchTransfer(data,tree)); setUndo({ before:data,after }); setData(after); setError(''); return true; }
    catch(e) { reload(); setError(e instanceof Error ? e.message : '修改未保存'); return false; }
  };
  return { data, items: data ? workbenchTree(data) : [], error, ready: !!data, commit, canUndo: !!undo,
    restore: () => { if (!undo) return false; try { const restored=saveWorkbench(undo.after,undo.before);setData(restored);setUndo(null);setError('');return true; } catch(e) { reload();setError(e instanceof Error ? e.message : '无法撤销');return false; } },
  };
}
