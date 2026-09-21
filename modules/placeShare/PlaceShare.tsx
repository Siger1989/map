import { useState } from 'react';
import { X, Share2, Copy } from 'lucide-react';
import type { RoutePlace } from '../navigation/types';
import { useRouteDialogFocus } from '../tracks/useRouteDialogFocus';
import { placeShareData } from './data';
import { sharePlace } from './delivery';
import './placeShare.css';

export function PlaceShare({ place, onClose, onExport }: {
  place: RoutePlace;
  onClose: () => void;
  onExport?: () => void;
}) {
  const root = useRouteDialogFocus(onClose);
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [manualCopy, setManualCopy] = useState(false);
  const data = placeShareData(place);
  const share = async () => {
    if (busy) return;
    setBusy(true); setMessage('');
    try { setMessage(await sharePlace(place)); }
    catch (e) { setMessage(e instanceof Error ? e.name === 'AbortError' ? '已取消分享' : e.message : '分享失败'); }
    finally { setBusy(false); }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(data.text); setMessage('地点名称、坐标和链接已复制'); }
    catch { setManualCopy(true); setMessage('请长按下方文字复制'); }
  };
  return <div className="place-share-backdrop">
    <section ref={root} className="place-share-panel" role="dialog" aria-modal="true" aria-label="分享地点" onKeyDown={event => event.stopPropagation()}>
      <header><strong>分享地点</strong><button aria-label="关闭地点分享" onClick={onClose}><X size={18}/></button></header>
      <div className="place-share-body">
        <strong className="place-share-name" title={data.name}>{data.name}</strong>
        <p>经度、纬度：{data.coordinates}</p>
        <small>名称、坐标和地图链接</small>
        <div className="place-share-actions"><button disabled={busy} onClick={() => void share()}><Share2 size={16}/>分享位置</button><button onClick={() => void copy()}><Copy size={16}/>复制信息</button></div>
        {onExport && <button className="place-share-export" onClick={onExport}>导出标记文件</button>}
        {message && <p role="status">{message}</p>}
        {manualCopy && <textarea readOnly aria-label="待复制的地点信息" value={data.text} onFocus={event => event.currentTarget.select()} />}
      </div>
    </section>
  </div>;
}
