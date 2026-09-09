import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { measurementProfile } from './profile';
import type { MeasurePoint } from './data';
import { deliverPhoto } from '../photos/export';

export function MeasurementShare({
  points,
  name,
  onClose,
}: {
  points: MeasurePoint[];
  name: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0),
    [url, setUrl] = useState(''),
    [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState(''),
    [busy, setBusy] = useState(false);
  const pages = Math.ceil((points.length - 1) / 10);
  useEffect(() => {
    let cancelled = false,
      preview = '';
    setFile(null);
    setUrl('');
    setStatus('正在生成剖面图…');
    const { svg, width, height } = measurementProfile(points, name, page);
    const source = URL.createObjectURL(
      new Blob([svg], { type: 'image/svg+xml' }),
    );
    const img = new Image();
    const timer = setTimeout(() => {
      if (!cancelled) setStatus('图片生成超时，请关闭后重试');
      img.src = '';
    }, 15000);
    img.onload = () => {
      clearTimeout(timer);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setStatus('无法生成图片');
        return;
      }
      ctx.drawImage(img, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (cancelled) return;
          if (!blob) {
            setStatus('图片生成失败');
            return;
          }
          preview = URL.createObjectURL(blob);
          setUrl(preview);
          setFile(
            new File([blob], `Shantu-measurement-${page + 1}.jpg`, {
              type: 'image/jpeg',
            }),
          );
          setStatus('');
        },
        'image/jpeg',
        0.95,
      );
    };
    img.onerror = () => {
      clearTimeout(timer);
      if (!cancelled) setStatus('图片生成失败，请重试');
    };
    img.src = source;
    return () => {
      cancelled = true;
      clearTimeout(timer);
      img.onload = null;
      img.onerror = null;
      URL.revokeObjectURL(source);
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [points, name, page]);
  const deliver = async (share: boolean) => {
    if (!file || busy) return;
    setBusy(true);
    try {
      setStatus(await deliverPhoto(file, share));
    } catch (e) {
      setStatus(
        e instanceof DOMException && e.name === 'AbortError'
          ? '已取消分享'
          : e instanceof Error
            ? e.message
            : '分享失败',
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className="measurement-share"
      role="dialog"
      aria-modal="true"
      aria-label="测量剖面图预览"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <header>
        <strong>测量剖面图</strong>
        <button autoFocus onClick={onClose} aria-label="关闭测量分享">
          <X size={18} />
        </button>
      </header>
      <div className="measurement-share-image">
        {url && (
          <img
            src={url}
            alt={`测量工程剖面图，第${page + 1}页，含坐标、海拔和分段测量表`}
          />
        )}
      </div>
      <footer>
        {pages > 1 && (
          <>
            <button
              disabled={!page || busy}
              onClick={() => setPage((p) => p - 1)}
            >
              上一页
            </button>
            <span>
              {page + 1}/{pages}
            </span>
            <button
              disabled={page === pages - 1 || busy}
              onClick={() => setPage((p) => p + 1)}
            >
              下一页
            </button>
          </>
        )}
        <button disabled={!file || busy} onClick={() => void deliver(false)}>
          保存图片
        </button>
        <button disabled={!file || busy} onClick={() => void deliver(true)}>
          分享{pages > 1 ? '本页' : ''}
        </button>
      </footer>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
