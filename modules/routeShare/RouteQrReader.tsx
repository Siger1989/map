import { useState } from 'react';
import { QrCamera } from '../mapSources/QrCamera';
import { readQr } from '../mapSources/qr';
import { readRouteQr, qrAccuracy, qrDistance, type RouteQr } from './qrCodec';
import { qrTransfer } from './qrImport';
import { mergeData } from '../outdoor/exchange';
import { formatDistance, TRAVEL_MODES } from '../navigation/types';
import type { RouteFavorite } from '../navigation/favorites';
import '../mapSources/mapSources.css';
import './routeShare.css';
export function RouteQrReader({
  initial,
  onLoaded,
  onClose,
}: {
  initial?: string;
  onLoaded: (
    favorite: RouteFavorite | null,
    points: [number, number][],
  ) => void;
  onClose: () => void;
}) {
  const parseInitial = () => {
    try {
      return initial ? readRouteQr(initial) : null;
    } catch {
      return null;
    }
  };
  const [data, setData] = useState<RouteQr | null>(parseInitial),
    [camera, setCamera] = useState(false),
    [error, setError] = useState(
      initial && !data ? '路线二维码已损坏或格式不受支持' : '',
    ),
    [busy, setBusy] = useState(false);
  const read = (text: string) => {
    setCamera(false);
    setError('');
    try {
      setData(readRouteQr(text));
    } catch (e) {
      setError(e instanceof Error ? e.message : '二维码不可用');
    }
  };
  const load = () => {
    try {
      const value = qrTransfer(data!);
      mergeData(value.transfer);
      onLoaded(value.favorite, data!.segments.flat());
    } catch (e) {
      setError(e instanceof Error ? e.message : '路线未载入');
    }
  };
  return (
    <div className="route-dialog-backdrop">
      <section
        className="route-dialog route-share glass"
        role="dialog"
        aria-modal="true"
        aria-label="扫码载入路线"
      >
        <header>
          <strong>扫码载入路线</strong>
          <button onClick={onClose}>关闭</button>
        </header>
        {camera ? (
          <QrCamera
            label="对准山兔路线二维码"
            onRead={read}
            onClose={() => setCamera(false)}
          />
        ) : (
          <>
            <div className="route-share-actions">
              <button onClick={() => setCamera(true)}>打开相机扫码</button>
              <label className="route-qr-file">
                {busy ? '识别中…' : '从分享图片识别'}
                <input
                  type="file"
                  accept="image/*"
                  aria-label="选择路线二维码图片"
                  disabled={busy}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (!f) return;
                    setBusy(true);
                    setError('');
                    try {
                      read(await readQr(f));
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : '图片读取失败',
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
            </div>
            {data && (
              <>
                <p>
                  <strong>{data.name}</strong>
                </p>
                <p>
                  {TRAVEL_MODES.find((m) => m.id === data.mode)?.label} ·
                  扫码线形 {formatDistance(qrDistance(data))} ·{' '}
                  {data.stops.length} 个地点
                </p>
                <p>
                  起点：{data.stops[0].name}
                  <br />
                  终点：{data.stops.at(-1)!.name}
                </p>
                <p>{qrAccuracy(data)}</p>
                <p>
                  此窗口仅预览；载入后保存在本机收藏或轨迹列表，可看全程再选择导航。
                </p>
                <button className="route-primary" onClick={load}>
                  载入路线并看全程
                </button>
              </>
            )}
            {error && (
              <p role="alert" className="route-error">
                {error}
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
