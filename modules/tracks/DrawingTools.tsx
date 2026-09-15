import { TRACK_COLORS } from './style';
import { CompactColor } from '../controls/CompactColor';
import { useBackHandler } from '../controls/backNavigation';
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, Ellipsis, Undo2, X } from 'lucide-react';
import type { ManualTracksState } from './useManualTracks';
import type { Coordinate } from '../navigation/types';
import { TrackStyleControls } from './TrackStyleControls';
import './drawingTools.css';

export const DRAWING_COLORS = [
  TRACK_COLORS[3],
  TRACK_COLORS[0],
  TRACK_COLORS[2],
  TRACK_COLORS[1],
  TRACK_COLORS[4],
  TRACK_COLORS[5],
];
export function DrawingTools({
  tracks: t,
  onFinish,
  onLocate,
  onEdit,
}: {
  tracks: ManualTracksState;
  onFinish: () => void;
  onLocate: (p: Coordinate) => void;
  onEdit: () => void;
}) {
  const [page, setPage] = useState<
    'colors' | 'custom' | 'settings' | 'exit' | null
  >(null);
  const root = useRef<HTMLDivElement>(null);
  useBackHandler(true, root, () => setPage(page ? null : 'exit'));
  useEffect(() => {
    if (!page || page === 'exit') return;
    const outside = (e: PointerEvent) => {
      if (e.target instanceof Node && !root.current?.contains(e.target))
        setPage(null);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [page]);
  const color = (value: string) => {
    t.setStyle({ ...t.style, color: value }, true);
    setPage(null);
  };
  return (
    <div
      ref={root}
      className="drawing-workspace"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          setPage(page ? null : 'exit');
        }
      }}
    >
      <div
        className="drawing-toolbar glass"
        role="toolbar"
        aria-label="绘制工具"
      >
        {DRAWING_COLORS.slice(0, 3).map((c, i) => (
          <button
            key={c}
            aria-label={`画笔${['绿色', '橙色', '蓝色'][i]}`}
            aria-pressed={t.style.color === c}
            onClick={() => color(c)}
          >
            <i style={{ backgroundColor: c }} />
          </button>
        ))}
        <button
          aria-label="绘制更多"
          aria-expanded={page !== null}
          onClick={() => setPage(page ? null : 'colors')}
        >
          <Ellipsis size={19} />
        </button>
        <button aria-label="撤销绘制" disabled={!t.canUndo} onClick={t.undo}>
          <Undo2 size={19} />
        </button>
        <button
          className="drawing-save"
          disabled={!t.draft.length}
          onClick={onFinish}
        >
          保存
        </button>
      </div>
      {page === 'colors' && (
        <div className="drawing-palette glass" aria-label="更多画笔颜色">
          <div>
            {DRAWING_COLORS.slice(3).map((c, i) => (
              <button
                key={c}
                aria-label={`画笔${['红色', '黄色', '白色'][i]}`}
                onClick={() => color(c)}
              >
                <i style={{ backgroundColor: c }} />
              </button>
            ))}
            <button
              onClick={() => {
                setPage('custom');
              }}
            >
              自定
            </button>
          </div>
          <div>
            <button
              onClick={() => {
                t.beginSection();
                setPage(null);
              }}
            >
              分段
            </button>
            <button onClick={() => setPage('settings')}>绘制设置</button>
          </div>
        </div>
      )}
      {page === 'custom' && (
        <section className="drawing-popover glass" aria-label="自定画笔颜色">
          <header>
            <strong>自定颜色</strong>
            <button aria-label="收起颜色" onClick={() => setPage(null)}>
              <X size={15} />
            </button>
          </header>
          <CompactColor
            value={t.style.color}
            onChange={color}
            label="画笔颜色"
          />
        </section>
      )}
      {page === 'settings' && (
        <section className="drawing-popover glass" aria-label="绘制设置">
          <header>
            <strong>绘制设置</strong>
            <button aria-label="收起绘制设置" onClick={() => setPage(null)}>
              <X size={15} />
            </button>
          </header>
          <div className="drawing-scroll">
            <label>
              贴合
              <select
                value={
                  t.roadSnapping ? 'road' : t.riverSnapping ? 'river' : 'off'
                }
                onChange={(e) => {
                  t.setRoadSnapping(e.target.value === 'road');
                  t.setRiverSnapping(e.target.value === 'river');
                }}
              >
                <option value="off">关闭</option>
                <option value="road">道路</option>
                <option value="river">河道</option>
              </select>
            </label>
            <label>
              节点吸附
              <input
                type="checkbox"
                checked={t.snapping}
                onChange={(e) => t.setSnapping(e.target.checked)}
              />
            </label>
            <label>
              名称
              <input
                value={t.draftName ?? ''}
                placeholder="自动命名"
                maxLength={60}
                onChange={(e) => t.setDraftName(e.target.value)}
              />
            </label>
            <label>
              当前段备注
              <input
                value={t.draftNote}
                maxLength={1600}
                onChange={(e) => t.setDraftCondition(e.target.value)}
              />
            </label>
            <TrackStyleControls
              style={t.style}
              onChange={(s) => t.setStyle(s, true)}
            />
            <div className="drawing-settings-actions">
              <button disabled={!t.draft.length} onClick={onEdit}>
                调整路线 / 路段
              </button>
              <button
                disabled={!t.draft.length}
                onClick={() => {
                  const p = t.draft.at(-1)?.at(-1);
                  if (p) onLocate(p);
                  setPage(null);
                }}
              >
                返回末端
              </button>
              <button onClick={() => setPage('exit')}>收起与退出</button>
            </div>
          </div>
        </section>
      )}
      {page === 'exit' && (
        <section className="drawing-popover glass" aria-label="退出绘制">
          <header>
            <strong>本次绘制</strong>
            <button aria-label="返回绘制" onClick={() => setPage(null)}>
              <ChevronLeft size={15} />
            </button>
          </header>
          <button onClick={() => setPage(null)}>继续绘制</button>
          <button onClick={t.finish}>保留草稿退出</button>
          <button
            className="danger"
            onClick={() => {
              if (t.clearDraft()) t.finish();
            }}
          >
            放弃本次绘制
          </button>
          <small>放弃只移除本次未保存修改，原路线保留。</small>
        </section>
      )}
      {t.error && (
        <div className="drawing-popover glass drawing-error" role="alert">
          {t.error}
        </div>
      )}
    </div>
  );
}

export function DrawingStart({
  tracks: t,
  onDraw,
  onOpen,
}: {
  tracks: ManualTracksState;
  onDraw: (point?: Coordinate) => void;
  onOpen: (id: string) => void;
}) {
  const [creating, setCreating] = useState(false),
    [id, setId] = useState('');
  const [discard, setDiscard] = useState(false);
  return (
    <section className="drawing-start" aria-label="画线">
      {!!t.draft.length ? (
        <>
          <strong>未完成草稿 · {t.draftName || '未命名路线'}</strong>
          <button
            className="route-primary"
            onClick={() => {
              t.start();
              onDraw(t.draft.at(-1)?.at(-1));
            }}
          >
            继续绘制
          </button>
          <button onClick={() => setDiscard(!discard)}>放弃本次绘制</button>
          {discard && (
            <div role="alert">
              <small>仅放弃未保存修改，原路线保留。</small>
              <button
                onClick={() => {
                  t.clearDraft();
                  setDiscard(false);
                }}
              >
                确认放弃
              </button>
              <button onClick={() => setDiscard(false)}>保留草稿</button>
            </div>
          )}
        </>
      ) : creating ? (
        <>
          <label>
            名称
            <input
              aria-label="新路线名称"
              placeholder="可不填"
              maxLength={60}
              value={t.draftName ?? ''}
              onChange={(e) => t.setDraftName(e.target.value)}
            />
          </label>
          <TrackStyleControls
            style={t.style}
            onChange={(s) => t.setStyle(s, true)}
          />
          <label>
            备注
            <input
              aria-label="首段备注"
              value={t.draftNote}
              maxLength={1600}
              onChange={(e) => t.setDraftCondition(e.target.value)}
            />
          </label>
          <button
            className="route-primary"
            onClick={() => {
              if (t.startNew(t.draftName ?? '')) onDraw();
            }}
          >
            开始画线
          </button>
        </>
      ) : (
        <>
          <button className="route-primary" onClick={() => setCreating(true)}>
            新建路线
          </button>
          <label>
            续画
            <select
              aria-label="选择续画路线"
              value={id}
              onChange={(e) => setId(e.target.value)}
            >
              <option value="">选择已有路线</option>
              {t.saved
                .filter((track) => !track.hidden)
                .map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={!id}
            onClick={() => {
              if (t.continueTrack(id))
                onDraw(
                  t.saved
                    .find((track) => track.id === id)
                    ?.segments.at(-1)
                    ?.at(-1),
                );
            }}
          >
            续画已有路线
          </button>
          <button disabled={!id} onClick={() => onOpen(id)}>
            查看所选路线
          </button>
        </>
      )}
      {t.error && <p role="alert">{t.error}</p>}
    </section>
  );
}
