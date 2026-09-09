import { useEffect, useMemo, useRef, useState } from 'react';
import { ImageIcon, FileJson, Download, Share2 } from 'lucide-react';
import { archiveBlob, archiveName, ZIP_MIME } from '../files/archive';
import { deliverFile } from '../files/delivery';
import { renderRouteImage } from '../routeShare/image';
import { workbenchImageRoutes } from './workbenchShareData';
import type { WorkbenchItem } from './workbenchTree';

type Props = {
  items: WorkbenchItem[];
  ids: string[];
  busy: boolean;
  onShare: (ids: string[], send: boolean) => Promise<void>;
  onCopy: (ids: string[]) => Promise<void>;
};

/** Image and editable-data outputs share one dialog, with cancellable image work. */
export function WorkbenchShare(p: Props) {
  const routes = useMemo(
    () => workbenchImageRoutes(p.items, p.ids),
    [p.items, p.ids],
  );
  const [tab, setTab] = useState(routes.length ? 'image' : 'data');
  const [selectedId, setSelectedId] = useState(routes[0]?.id ?? '');
  const [images, setImages] = useState<Record<string, File>>({});
  const [bundle, setBundle] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [url, setUrl] = useState('');
  const operation = useRef<AbortController | null>(null);
  const image = images[selectedId];
  const route = routes.find((item) => item.id === selectedId);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => {
    if (!image) {
      setUrl('');
      return;
    }
    const next = URL.createObjectURL(image);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [image]);

  async function generate(all: boolean) {
    if (operation.current || !route) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    const targets = all ? routes : [route];
    const generated = { ...images };
    try {
      for (const [index, target] of targets.entries()) {
        setMessage(`正在生成 ${index + 1}/${targets.length}：${target.name}`);
        if (!generated[target.id]) {
          generated[target.id] = await renderRouteImage(
            target.data,
            controller.signal,
          );
          controller.signal.throwIfAborted();
          setImages({ ...generated });
        }
      }
      if (all) {
        setMessage('正在打包路线图片…');
        const blob = await archiveBlob(
          targets.map((target, index) => ({
            path: `${index + 1}-${archiveName(target.name)}.jpg`,
            data: generated[target.id],
          })),
          controller.signal,
        );
        controller.signal.throwIfAborted();
        setBundle(new File([blob], '山兔-路线图片.zip', { type: ZIP_MIME }));
      }
      setMessage(
        all
          ? `已生成 ${targets.length} 张图片，可切换预览或保存、分享整个图片包。`
          : '图片已生成，可查看大图、保存或分享。',
      );
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof Error ? error.message : '图片生成失败，请重试',
        );
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  async function output(file: File, send: boolean) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    try {
      const result = await deliverFile(file, send, controller.signal);
      if (!controller.signal.aborted)
        setMessage(
          send || window.GuanyunNative
            ? result
            : '已请求保存。若浏览器未下载图片，可打开大图后保存。',
        );
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(error instanceof Error ? error.message : '输出失败，请重试');
    } finally {
      if (operation.current === controller) {
        operation.current = null;
        if (!controller.signal.aborted) setBusy(false);
      }
    }
  }
  function cancel() {
    operation.current?.abort();
    operation.current = null;
    setBusy(false);
    setMessage('已取消，可重新生成。');
  }
  return (
    <div className="collection-share">
      {routes.length > 0 && (
        <div className="collection-share-tabs" aria-label="分享格式">
          <button
            aria-pressed={tab === 'image'}
            disabled={busy || p.busy}
            onClick={() => setTab('image')}
          >
            <ImageIcon size={16} />
            路线图片
          </button>
          <button
            aria-pressed={tab === 'data'}
            disabled={busy || p.busy}
            onClick={() => setTab('data')}
          >
            <FileJson size={16} />
            可编辑数据
          </button>
        </div>
      )}
      {tab === 'image' && route ? (
        <>
          {routes.length > 1 && (
            <label>
              预览路线
              <select
                aria-label="预览分享路线"
                value={selectedId}
                disabled={busy}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                {routes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p>
            全程地图、里程、海拔曲线与路线二维码；高程缺失时会注明。
          </p>
          {url && (
            <a
              className="collection-share-image"
              href={url}
              target="_blank"
              rel="noreferrer"
              aria-label="查看完整路线分享图片"
            >
              <img
                src={url}
                alt={`${route.name}的全程地图、路线数据、海拔曲线与二维码`}
              />
              <span>查看大图</span>
            </a>
          )}
          {!image && (
            <button
              className="collection-action-primary collection-share-generate"
              disabled={busy}
              onClick={() => void generate(false)}
            >
              <ImageIcon size={16} />
              生成路线图片
            </button>
          )}
          {image && (
            <div className="collection-action-pair">
              <button disabled={busy} onClick={() => void output(image, false)}>
                <Download size={15} />
                保存图片
              </button>
              <button
                className="collection-action-primary"
                disabled={busy}
                onClick={() => void output(image, true)}
              >
                <Share2 size={15} />
                分享图片
              </button>
            </div>
          )}
          {routes.length > 1 && (
            <div className="collection-share-batch">
              {bundle ? (
                <div className="collection-action-pair">
                  <button
                    disabled={busy}
                    onClick={() => void output(bundle, false)}
                  >
                    保存图片包
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => void output(bundle, true)}
                  >
                    分享图片包
                  </button>
                </div>
              ) : (
                <button disabled={busy} onClick={() => void generate(true)}>
                  生成全部 {routes.length} 张图片并打包
                </button>
              )}
              <small>
                图片只包含选中的路线与轨迹；完整收藏请选“可编辑数据”。
              </small>
            </div>
          )}
          {busy && (
            <button className="collection-share-cancel" onClick={cancel}>
              取消生成 / 输出
            </button>
          )}
          {message && <p role="status">{message}</p>}
        </>
      ) : (
        <>
          <p>
            包含选中条目的坐标、路线、文件夹层级和颜色，保存为可重新导入山兔的
            JSON 文件。
          </p>
          <div className="collection-action-buttons">
            <button
              className="collection-action-primary"
              disabled={p.busy}
              onClick={() => void p.onShare(p.ids, true)}
            >
              {p.busy ? '正在生成…' : '系统分享数据'}
            </button>
            <button
              disabled={p.busy}
              onClick={() => void p.onShare(p.ids, false)}
            >
              保存数据文件
            </button>
            <button disabled={p.busy} onClick={() => void p.onCopy(p.ids)}>
              复制 JSON 内容
            </button>
          </div>
        </>
      )}
    </div>
  );
}
