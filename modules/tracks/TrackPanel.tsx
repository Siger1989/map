import { useState } from 'react';
import { formatDistance, type Coordinate } from '../navigation/types';
import { JourneyPanel } from '../journey/JourneyPanel';
import { trackDistance } from './drawing';
import { TrackStyleControls } from './TrackStyleControls';
import { normalizeTrackStyle } from './style';
import type { ManualTracksState } from './useManualTracks';
export function TrackPanel({
  tracks: t,
  onDraw,
  onShow,
}: {
  tracks: ManualTracksState;
  onDraw: () => void;
  onShow: (points: Coordinate[]) => void;
}) {
  const [name, setName] = useState(''),
    [details, setDetails] = useState<string | null>(null);
  return (
    <section className="track-panel" aria-label="手绘轨迹">
      <div className="route-tabs" aria-label="绘制方式">
        <button
          aria-pressed={t.mode === 'freehand'}
          onClick={() => t.setMode('freehand')}
        >
          精定位＋平滑画
        </button>
        <button
          aria-pressed={t.mode === 'points'}
          onClick={() => t.setMode('points')}
        >
          逐点连线
        </button>
      </div>
      <p className="route-note">
        松手确认准星位置；平滑模式随后拖绿色牵引环。单指画，双指直接移动、缩放和调角度。
      </p>
      <label className="track-snap">
        <input
          type="checkbox"
          checked={t.roadSnapping}
          onChange={(e) => t.setRoadSnapping(e.target.checked)}
        />
        道路吸附<span>贴着地图中的道路和小路画；拖离可自由绘制</span>
      </label>
      <label className="track-snap">
        <input
          type="checkbox"
          checked={t.snapping}
          onChange={(e) => t.setSnapping(e.target.checked)}
        />
        节点吸附<span>靠近时锁定，松手连接</span>
      </label>
      <details className="track-settings">
        <summary>线条与防抖设置</summary>
        <TrackStyleControls style={t.style} onChange={t.setStyle} />
        <label className="slider-label" htmlFor="track-rod">
          牵引杆长度 <span>{t.rodLength}px</span>
        </label>
        <input
          id="track-rod"
          type="range"
          min="24"
          max="80"
          step="4"
          value={t.rodLength}
          onChange={(e) => t.setRodLength(Number(e.target.value))}
        />
      </details>
      <button className="route-primary" onClick={onDraw}>
        {t.draft.length || t.anchor ? '继续绘制轨迹' : '在地图上画轨迹'}
      </button>
      {!!t.draft.length && (
        <>
          <div className="route-result">
            <strong>
              {t.editingId ? '正在续画' : '草稿'}{' '}
              {formatDistance(trackDistance(t.draft))}
            </strong>
            <button
              onClick={() => setDetails(details === 'draft' ? null : 'draft')}
            >
              {details === 'draft' ? '收起统计' : '统计 / 天气'}
            </button>
          </div>
          {details === 'draft' && (
            <JourneyPanel segments={t.draft} onLocate={(p) => onShow([p])} />
          )}
          <div className="route-edit-actions">
            <button disabled={!t.canUndo} onClick={t.undo}>
              撤销
            </button>
            <button onClick={t.clearDraft}>
              {t.editingId ? '放弃本次续画' : '清空草稿'}
            </button>
          </div>
          <input
            className="track-name"
            aria-label="轨迹名称"
            placeholder={
              t.editingId ? '留空保留原线路名' : '轨迹名称（可不填）'
            }
            maxLength={60}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button
            className="route-primary"
            onClick={() => {
              if (t.save(name)) {
                setName('');
                setDetails(null);
              }
            }}
          >
            {t.editingId ? '保存整条线路' : '保存到本机'}
          </button>
        </>
      )}
      {t.error && (
        <p className="route-error" role="alert">
          {t.error}
        </p>
      )}
      <div className="track-saved-heading">
        <strong>已保存 {t.saved.length}/20</strong>
        <button
          aria-pressed={t.visible}
          onClick={() => t.setVisible(!t.visible)}
        >
          {t.visible ? '隐藏轨迹' : '显示轨迹'}
        </button>
      </div>
      {t.saved.map((track) => (
        <div className="track-record" key={track.id}>
          <div className="track-saved">
            <button
              className="track-open"
              onClick={() => {
                t.setVisible(true);
                onShow(track.segments.flat());
              }}
            >
              <strong>{track.name}</strong>
              <small>{formatDistance(trackDistance(track.segments))}</small>
            </button>
            <button
              className="track-delete"
              disabled={t.editingId === track.id}
              aria-label={`删除轨迹 ${track.name}`}
              onClick={() => t.remove(track.id)}
            >
              删除
            </button>
          </div>
          <div className="route-edit-actions">
            <button
              onClick={() => setDetails(details === track.id ? null : track.id)}
            >
              {details === track.id ? '收起详情' : '统计 / 天气 / 样式'}
            </button>
            <button
              onClick={() => {
                if (t.continueTrack(track.id)) {
                  setDetails(null);
                  onDraw();
                }
              }}
            >
              续画
            </button>
          </div>
          {details === track.id && (
            <>
              <TrackStyleControls
                style={normalizeTrackStyle(track.style)}
                onChange={(style) => t.updateStyle(track.id, style)}
              />
              <JourneyPanel
                segments={track.segments}
                onLocate={(p) => onShow([p])}
              />
            </>
          )}
          {details === track.id && (
            <div className="route-edit-actions">
              <button
                disabled={!!t.draft.length}
                onClick={() => t.reverseTrack(track.id)}
              >
                交换起终点
              </button>
              <button
                disabled={!!t.draft.length}
                onClick={() => t.mergeTrack(track.id)}
              >
                合并相接线路
              </button>
            </div>
          )}
        </div>
      ))}
      <p className="route-note">
        道路吸附需放大地图并加载道路，缺少数据时自由绘制；吸附不代表道路当前可通行。相接端点保存时合并，轨迹只存本机。
      </p>
    </section>
  );
}
export function TrackTools({
  tracks: t,
  onFinish,
  onLocate,
}: {
  tracks: ManualTracksState;
  onFinish: () => void;
  onLocate: (point: Coordinate) => void;
}) {
  return (
    <div className="track-tools glass" aria-label="绘制工具">
      <button
        aria-label="切换绘制方式"
        onClick={() => t.setMode(t.mode === 'freehand' ? 'points' : 'freehand')}
      >
        {t.mode === 'freehand' ? '平滑画' : '逐点'}
      </button>
      <button
        aria-pressed={t.roadSnapping}
        onClick={() => t.setRoadSnapping(!t.roadSnapping)}
      >
        道路{t.roadSnapping ? '吸附' : '自由'}
      </button>
      <button
        aria-pressed={t.snapping}
        onClick={() => t.setSnapping(!t.snapping)}
      >
        节点{t.snapping ? '开' : '关'}
      </button>
      {t.mode === 'freehand' && (
        <button onClick={() => t.setAnchor(null)}>
          {t.anchor && !t.draft.length ? '重定起点' : '另起一段'}
        </button>
      )}
      {t.anchor && (
        <button onClick={() => onLocate(t.anchor!)}>定位端点</button>
      )}
      <button disabled={!t.canUndo} onClick={t.undo}>
        撤销
      </button>
      <button onClick={onFinish}>完成</button>
    </div>
  );
}
