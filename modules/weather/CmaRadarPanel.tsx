'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus, RefreshCw, X } from 'lucide-react';
import { formatRadarTime, radarAgeMinutes, useCmaRadar } from './useCmaRadar';
import './CmaRadarPanel.css';

export function CmaRadarPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const radar = useCmaRadar(open);
  const [imageState, setImageState] = useState<{ key: string; status: 'loading' | 'loaded' | 'error' } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const closeLightboxRef = useRef<HTMLButtonElement>(null);
  const expandTriggerRef = useRef<HTMLButtonElement>(null);
  const frame = radar.selectedFrame;
  const frameAge = frame ? radarAgeMinutes(frame.observedAt) : null;
  const latestFrameId = radar.frames[0]?.id ?? null;
  const imageKey = frame ? `${radar.generation}:${frame.id}` : null;
  const imageLoading = !!frame && (imageState?.key !== imageKey || imageState.status === 'loading');
  const imageError = !!frame && imageState?.key === imageKey && imageState.status === 'error';
  const imageReady = !!frame && imageState?.key === imageKey && imageState.status === 'loaded';

  useEffect(() => {
    if (open) return;
    setExpanded(false);
    setZoom(1);
  }, [open]);

  useEffect(() => {
    if (expanded) closeLightboxRef.current?.focus({ preventScroll: true });
    else if (expandTriggerRef.current?.isConnected) expandTriggerRef.current.focus({ preventScroll: true });
  }, [expanded]);

  if (!open) return null;

  const step = (delta: -1 | 1) => radar.select(radar.selectedIndex + delta);
  const imageStatus = !frame
    ? radar.error || (radar.directory ? '暂无可查看的观测帧' : '正在获取雷达目录…')
    : imageError
      ? '雷达图片加载失败，请更新重试'
      : imageLoading || !imageReady
        ? '正在加载雷达原图…'
        : radar.latestAgeMinutes !== null && radar.latestAgeMinutes > 90
          ? `最新观测延迟 ${radar.latestAgeMinutes} 分钟，已超过 90 分钟`
          : `本帧延迟 ${frameAge ?? '未知'} 分钟`;
  const imageAlt = frame
    ? `${radar.directory?.product ?? '雷达拼图'}，${radar.directory?.unit ?? '单位未知'}，${formatRadarTime(frame.observedAt)}；原图含完整地图、图例与来源署名`
    : '无可用雷达图像';

  const radarImage = frame && !imageError ? (
    <img
      key={imageKey!}
      src={frame.imagePath}
      alt={imageAlt}
      draggable={false}
      style={{ visibility: imageReady ? 'visible' : 'hidden' }}
      onLoad={() => setImageState({ key: imageKey!, status: 'loaded' })}
      onError={() => setImageState({ key: imageKey!, status: 'error' })}
    />
  ) : null;

  return (
    <>
      <section className="cma-radar-panel glass" aria-label="雷达实况图查看器">
        <header className="cma-radar-heading">
          <div>
            <strong>雷达实况图</strong>
            <small>{radar.directory?.source ?? '国家气象数据网'}</small>
          </div>
          <button className="cma-radar-icon-button" type="button" onClick={onClose} aria-label="关闭雷达实况图">
            <X size={16} />
          </button>
        </header>

        <p className="cma-radar-product">
          {radar.directory?.product ?? '全国雷达拼图 · 组合反射率'} · {radar.directory?.unit ?? 'dBZ'}
        </p>

        <div className={`cma-radar-image${imageLoading || imageError || !frame ? ' is-placeholder' : ''}`}>
          {radarImage}
          {(imageLoading || !frame || imageError) && (
            <span role="status" aria-live="polite">{imageStatus}</span>
          )}
          {imageReady && (
            <button
              className="cma-radar-expand"
              type="button"
              ref={expandTriggerRef}
              onClick={() => { setZoom(1); setExpanded(true); }}
              aria-label="放大查看雷达原图"
            >
              <Maximize2 size={14} /> 放大查看原图
            </button>
          )}
        </div>

        <div className="cma-radar-meta">
          <span>{frame ? formatRadarTime(frame.observedAt) : radar.loading ? '正在获取观测时次…' : '暂无观测时次'}</span>
          {frame && frame.id !== latestFrameId && frameAge !== null && (
            <span>当前查看历史帧 · 距今 {frameAge} 分钟</span>
          )}
          {radar.latestAgeMinutes !== null && (frame?.id === latestFrameId || radar.latestAgeMinutes > 90) && (
            <span className={radar.latestAgeMinutes > 90 ? 'is-stale' : ''}>
              {radar.latestAgeMinutes > 90
                ? `最新观测已延迟 ${radar.latestAgeMinutes} 分钟 · 超过 90 分钟`
                : `数据源最新观测延迟 ${radar.latestAgeMinutes} 分钟`}
            </span>
          )}
        </div>

        {radar.loading && frame && !imageLoading && <p className="cma-radar-fetch-status" role="status">正在更新雷达目录，当前图像时次如上</p>}

        <nav className="cma-radar-controls" aria-label="雷达观测帧控制">
          <button type="button" disabled={!frame || radar.selectedIndex === 0} onClick={() => radar.select(0)}>最新</button>
          <button type="button" aria-label="前一帧" disabled={!frame || radar.selectedIndex >= radar.frames.length - 1} onClick={() => step(1)}>
            <ChevronLeft size={15} /> 前一帧
          </button>
          <button type="button" aria-label="后一帧" disabled={!frame || radar.selectedIndex <= 0} onClick={() => step(-1)}>
            后一帧 <ChevronRight size={15} />
          </button>
          <button type="button" aria-label="更新雷达目录并重试图片" disabled={radar.loading} onClick={() => {
            void radar.refresh();
          }}>
            <RefreshCw size={14} className={radar.loading ? 'is-spinning' : ''} /> 更新
          </button>
        </nav>
      </section>

      {expanded && frame && imageReady && !imageError && typeof document !== 'undefined' && createPortal((
        <section
          className="cma-radar-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="放大查看雷达原图"
          tabIndex={-1}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              setExpanded(false);
            }
          }}
        >
          <header className="cma-radar-lightbox-header">
            <div><strong>雷达实况图</strong><span>{formatRadarTime(frame.observedAt)}</span></div>
            <div className="cma-radar-zoom-controls" aria-label="原图缩放">
              <button type="button" aria-label="缩小原图" disabled={zoom <= 1} onClick={() => setZoom(value => Math.max(1, value - 0.25))}><Minus size={17} /></button>
              <span>{Math.round(zoom * 100)}%</span>
              <button type="button" aria-label="放大原图" disabled={zoom >= 3} onClick={() => setZoom(value => Math.min(3, value + 0.25))}><Plus size={17} /></button>
              <button ref={closeLightboxRef} type="button" aria-label="关闭放大原图" onClick={() => setExpanded(false)}><X size={18} /></button>
            </div>
          </header>
          <div className="cma-radar-lightbox-image" style={{ '--radar-zoom': zoom } as CSSProperties}>
            <img src={frame.imagePath} alt={imageAlt} draggable={false}
              onLoad={() => setImageState({ key: imageKey!, status: 'loaded' })}
              onError={() => { setImageState({ key: imageKey!, status: 'error' }); setExpanded(false); }} />
          </div>
          <footer>{radar.directory?.source} · {radar.directory?.product} · {radar.directory?.unit}</footer>
        </section>
      ), document.body)}
    </>
  );
}
