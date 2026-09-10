import { useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Share2,
  Minus,
  Plus,
  Maximize,
  Settings2,
  Info,
  RefreshCw,
  Bookmark,
  X,
} from 'lucide-react';
import type { Annotation } from '../annotations/data';
import { deliverPhoto } from '../photos/export';
import { surveyDrawing } from './surveyDrawing';
import { sectionImageName } from './exportName';
import { surveyBasis, surveySettings } from './surveyLine';
import { SURVEY_SCALES, surveyScaleWidth } from './surveyScale';
import type { SurveySectionState } from './useSurveySection';

/** Full-screen viewer; keeps the engineering sheet's original landscape geometry. */
export function SurveySheet({
  state,
  markers,
  onInfo,
  onClose,
  onFavorites,
}: {
  state: SurveySectionState;
  markers: Annotation[];
  onInfo: () => void;
  onClose: () => void;
  onFavorites: () => void;
}) {
  const object = state.object!,
    line = object.settings.survey!,
    terrain = object.settings.surveyTerrain;
  const [zoom, setZoom] = useState(1),
    [page, setPage] = useState(0);
  const [exporting, setExporting] = useState(false),
    [message, setMessage] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const drawing = useMemo(() => {
    if (!terrain) return null;
    try {
      return surveyDrawing(line, terrain, object.name, markers);
    } catch (e) {
      return { error: e instanceof Error ? e.message : '图纸生成失败' };
    }
  }, [line, terrain, object.name, markers]);
  const pages = drawing && 'pages' in drawing ? drawing.pages : [];
  const shownPage = Math.min(page, Math.max(0, pages.length - 1));
  const imagePage = pages[shownPage] ?? null;
  const changePage = (next: number) => {
    setPage(next);
    setZoom(1);
    setMessage('');
    scroll.current?.scrollTo(0, 0);
  };
  const exportImage = async (share: boolean) => {
    if (!imagePage) return;
    setExporting(true);
    setMessage('');
    const url = URL.createObjectURL(
      new Blob([imagePage.svg], { type: 'image/svg+xml;charset=utf-8' }),
    );
    try {
      const image = new window.Image();
      image.src = url;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = imagePage.width;
      canvas.height = imagePage.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法生成图片');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', 0.95),
      );
      if (!blob) throw new Error('图片生成失败');
      const result = await deliverPhoto(
        new File([blob], sectionImageName(shownPage), { type: 'image/jpeg' }),
        share,
      );
      setMessage(
        !share && window.GuanyunNative
          ? '请在系统文件窗口选择位置并点击“保存”；图片不会自动进入相册。'
          : result,
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '图片输出失败');
    } finally {
      URL.revokeObjectURL(url);
      setExporting(false);
    }
  };
  return (
    <section
      className="survey-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="勘探线平剖图"
    >
      <header className="survey-sheet-header">
        <button onClick={onClose} aria-label="关闭平剖图">
          <ChevronLeft size={20} />
        </button>
        <strong>平剖图</strong>
        <button onClick={onInfo}>
          <Info size={17} />
          信息
        </button>
        <button
          onClick={() => setSettingsOpen(!settingsOpen)}
          aria-expanded={settingsOpen}
        >
          <Settings2 size={17} />
          设置
        </button>
      </header>
      {settingsOpen && (
        <section className="survey-sheet-settings" aria-label="图纸设置">
          <header>
            <strong>图纸设置</strong>
            <button
              onClick={() => setSettingsOpen(false)}
              aria-label="关闭图纸设置"
            >
              <X size={16} />
            </button>
          </header>
          <p>方向角 A→B：{surveyBasis(line).bearing.toFixed(2)}°</p>
          <label>
            水平比例尺
            <select
              aria-label="图纸比例尺"
              value={line.printScale ?? 0}
              onChange={(e) =>
                state.commit(
                  surveySettings(
                    {
                      ...line,
                      printScale: Number(e.target.value) || undefined,
                    },
                    object.settings,
                  ),
                )
              }
            >
              <option value={0}>自动铺满</option>
              {SURVEY_SCALES.map((n) => {
                let fits = true;
                try {
                  if (terrain) surveyScaleWidth(terrain.end - terrain.start, n);
                } catch {
                  fits = false;
                }
                return (
                  <option key={n} value={n} disabled={!fits}>
                    1:{n}
                    {fits ? '' : '（容不下全线）'}
                  </option>
                );
              })}
            </select>
          </label>
          <p>比例尺按完整图纸宽 420 mm 打印。平面图等比，剖面纵向比例另注。</p>
          <label>
            等高距
            <select
              value={line.interval}
              aria-label="剖面等高距"
              onChange={(e) =>
                state.commit(
                  surveySettings(
                    { ...line, interval: Number(e.target.value) },
                    object.settings,
                  ),
                )
              }
            >
              {[1, 2, 5, 10, 20, 25, 50, 100, 200, 500].map((n) => (
                <option key={n} value={n}>
                  {n} m
                </option>
              ))}
            </select>
          </label>
          <div>
            <button
              disabled={state.busy}
              onClick={state.retry}
              aria-label="重试地形采样"
            >
              <RefreshCw size={15} />
              刷新地形
            </button>
            <button onClick={onFavorites}>
              <Bookmark size={15} />
              已收藏
            </button>
          </div>
        </section>
      )}
      <div className="survey-sheet-scroll" ref={scroll}>
        <div className="survey-sheet-stage" data-zoomed={zoom > 1}>
          {imagePage ? (
            <img
              alt={
                shownPage === 0
                  ? '勘探线地形剖面及等高线平面图'
                  : '勘探线完整资料附表'
              }
              style={{ width: `${zoom * 100}%`, maxWidth: 'none' }}
              src={
                'data:image/svg+xml;charset=utf-8,' +
                encodeURIComponent(imagePage.svg)
              }
            />
          ) : (
            <div className="survey-sheet-empty">
              <FilePlaceholder />
              <p role="status">
                {state.busy
                  ? '正在读取地形，请稍候…'
                  : drawing && 'error' in drawing
                    ? drawing.error
                    : '地形尚未就绪'}
              </p>
              <button onClick={state.retry} disabled={state.busy}>
                重新读取地形
              </button>
            </div>
          )}
        </div>
      </div>
      {(message || state.error || state.busy) && (
        <p
          className="survey-sheet-status"
          role={state.error ? 'alert' : 'status'}
        >
          {message || state.error || '正在更新地形…'}
        </p>
      )}
      <nav className="survey-sheet-pages" aria-label="图纸分页">
        <button
          disabled={shownPage === 0}
          onClick={() => changePage(shownPage - 1)}
          aria-label="上一页"
        >
          <ChevronLeft size={18} />
        </button>
        <span>
          {shownPage + 1} / {Math.max(1, pages.length)} ·{' '}
          {shownPage === 0 ? '平剖图' : '资料附表'}
        </span>
        <button
          disabled={shownPage >= pages.length - 1}
          onClick={() => changePage(shownPage + 1)}
          aria-label="下一页"
        >
          <ChevronRight size={18} />
        </button>
      </nav>
      <footer className="survey-sheet-footer">
        <div className="survey-sheet-zoom">
          <button
            onClick={() => setZoom((n) => Math.max(1, n - 0.5))}
            disabled={zoom === 1}
            aria-label="缩小图纸"
          >
            <Minus size={17} />
          </button>
          <button
            onClick={() => {
              setZoom(1);
              scroll.current?.scrollTo(0, 0);
            }}
            aria-label="全图"
          >
            <Maximize size={15} />
            <span>{zoom === 1 ? '全图' : `${Math.round(zoom * 100)}%`}</span>
          </button>
          <button
            onClick={() => setZoom((n) => Math.min(6, n + 0.5))}
            disabled={zoom === 6}
            aria-label="放大图纸"
          >
            <Plus size={17} />
          </button>
        </div>
        <button
          className="survey-primary"
          disabled={exporting || !imagePage}
          onClick={() => void exportImage(false)}
        >
          <Download size={17} />
          {exporting ? '处理中' : '保存图片'}
        </button>
        <button
          disabled={exporting || !imagePage}
          onClick={() => void exportImage(true)}
        >
          <Share2 size={17} />
          分享
        </button>
      </footer>
    </section>
  );
}
function FilePlaceholder() {
  return <Maximize size={28} aria-hidden="true" />;
}
