import { useEffect, useRef, useState } from 'react';
import { TRAVEL_MODES } from '../navigation/types';
import { externalLegs, routeFileText, type ShareRoute } from './data';
import { deliverRouteFile } from './delivery';
import { renderRouteImage } from './image';
import '../guidance/navigationStart.css';
import './routeShare.css';
export function RouteShare({
  data,
  onClose,
}: {
  data: ShareRoute;
  onClose: () => void;
}) {
  const [image, setImage] = useState<File | null>(null),
    [preview, setPreview] = useState(''),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [mode, setMode] = useState(data.mode);
  const abort = useRef<AbortController | null>(null),
    url = useRef('');
  useEffect(
    () => () => {
      abort.current?.abort();
      if (url.current) URL.revokeObjectURL(url.current);
    },
    [],
  );
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setMessage('');
    try {
      const msg = await fn();
      if (msg) setMessage(msg);
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.name === 'AbortError'
            ? '已取消'
            : e.message
          : '分享失败',
      );
    } finally {
      setBusy(false);
    }
  };
  const generate = () =>
    run(async () => {
      const controller = new AbortController();
      abort.current = controller;
      setMessage('正在加载整条路线的底图、地名和高程…');
      const file = await renderRouteImage(data, controller.signal);
      if (url.current) URL.revokeObjectURL(url.current);
      url.current = URL.createObjectURL(file);
      setImage(file);
      setPreview(url.current);
      setMessage('图片已生成，可预览后保存或分享');
    });
  const file = (format: 'gpx' | 'kml', share: boolean) =>
    run(() =>
      deliverRouteFile(
        new File(
          [routeFileText(data, format)],
          `Shantu-route-${Date.now()}.${format}`,
          {
            type:
              format === 'gpx'
                ? 'application/gpx+xml'
                : 'application/vnd.google-earth.kml+xml',
          },
        ),
        share,
      ),
    );
  const links = externalLegs({ ...data, mode });
  return (
    <div className="route-dialog-backdrop">
      <section
        className="route-dialog route-share glass"
        role="dialog"
        aria-modal="true"
        aria-label="分享路线"
      >
        <header>
          <strong>分享路线</strong>
          <button
            onClick={() => {
              abort.current?.abort();
              onClose();
            }}
          >
            关闭
          </button>
        </header>
        <p>
          {data.name}
          {data.approach ? ' · 含到起点路线' : ''}
        </p>
        <div className="route-share-actions">
          <button disabled={busy} onClick={() => void generate()}>
            {image ? '重新生成图片' : '生成全程图片'}
          </button>
          {image && (
            <>
              <button
                disabled={busy}
                onClick={() => void run(() => deliverRouteFile(image, false))}
              >
                保存图片
              </button>
              <button
                disabled={busy}
                onClick={() => void run(() => deliverRouteFile(image, true))}
              >
                分享图片
              </button>
            </>
          )}
        </div>
        {preview && (
          <a
            href={preview}
            target="_blank"
            rel="noreferrer"
            aria-label="查看完整路线分享图片"
          >
            <img
              className="route-share-preview"
              src={preview}
              alt="完整路线地图、路线数据和海拔变化图"
            />
          </a>
        )}
        <p role="status">{message}</p>
        <details>
          <summary>通用路线文件 · GPX / KML</summary>
          <p>保留完整线形和原始轨迹时间，可导入支持轨迹的地图应用。</p>
          <div className="route-share-actions">
            {(['gpx', 'kml'] as const).map((f) => (
              <div key={f}>
                <button disabled={busy} onClick={() => void file(f, true)}>
                  分享 {f.toUpperCase()}
                </button>
                <button disabled={busy} onClick={() => void file(f, false)}>
                  保存 {f.toUpperCase()}
                </button>
              </div>
            ))}
          </div>
        </details>
        <details>
          <summary>用高德导航 / 分享导航链接</summary>
          <div className="route-modes">
            {TRAVEL_MODES.map((m) => (
              <button
                key={m.id}
                aria-pressed={mode === m.id}
                onClick={() => setMode(m.id)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p>
            高德会按地点重新规划，可能与原线形不同。多途经点按顺序分段打开；保留精确线形请分享
            GPX/KML。
          </p>
          {links.map((l, i) => (
            <div key={i} className="route-external-leg">
              <a href={l.url}>
                {links.length > 1 ? `第 ${i + 1} 段：` : ''}
                {l.name}
              </a>
              <button
                onClick={() =>
                  void run(async () => {
                    if (window.GuanyunNative?.routeLinkShare) {
                      const r = window.GuanyunNative.routeLinkShare(l.url);
                      if (r !== 'ok') throw new Error(r);
                      return '已请求打开系统分享';
                    }
                    if (navigator.share) {
                      await navigator.share({ title: data.name, url: l.url });
                      return '已交给系统分享';
                    }
                    await navigator.clipboard.writeText(l.url);
                    return '导航链接已复制';
                  })
                }
              >
                分享链接
              </button>
            </div>
          ))}
        </details>
      </section>
    </div>
  );
}
