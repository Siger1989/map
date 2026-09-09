import { SmartInput } from '../input/SmartText';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, History, Play } from 'lucide-react';
import { formatDistance, type Coordinate } from '../navigation/types';
import { JourneyPanel } from '../journey/JourneyPanel';
import { SharedTrackDetails } from './SharedTrackDetails';
import { trackDistance } from './drawing';
import {
  keepsOriginalPoints,
  trackSourceLabel,
  hasTrackTime,
} from './provenance';
import { TrackStyleControls } from './TrackStyleControls';
import { normalizeTrackStyle } from './style';
import type { ManualTracksState } from './useManualTracks';
import { drawingArea, drawingTime } from './archive';
import type { VisiblePhoto } from '../photos/storage';
import { TrackPhotoGallery } from '../photos/TrackPhotoGallery';
export function TrackPanel({
  tracks: t,
  onDraw,
  onShow,
  onOpen,
  onEditNodes,
  onNavigate,
  onShare,
  navigationError,
  photos,
  onPhoto,
  onAddPhotos,
}: {
  tracks: ManualTracksState;
  onDraw: (endpoint?: Coordinate) => void;
  onShow: (points: Coordinate[]) => void;
  onOpen?: (id: string) => void;
  onEditNodes: (id: string) => void;
  onNavigate: (id: string) => void;
  onShare: (id: string) => void;
  navigationError: string;
  photos: VisiblePhoto[];
  onPhoto: (id: string) => void;
  onAddPhotos: (trackId: string) => void;
}) {
  const [name, setName] = useState(t.draftName ?? '');
  const [choosing, setChoosing] = useState(false);
  const [continueId, setContinueId] = useState('');
  const [editShared, setEditShared] = useState(false);
  const records = [...t.saved].sort(
    (a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt),
  );
  const continuation = records.find((track) => track.id === continueId);
  const canContinue =
    !!continuation || (continueId === 'draft' && !!t.draft.length);
  const details = t.selectedId,
    setDetails = t.select;
  const selectedTrack = records.find((track) => track.id === details);
  const selectedDraft = details === 'draft' && t.draft.length > 0;
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    setEditShared(false);
    const frame = requestAnimationFrame(() => {
      const record = Array.from(
        section.current?.querySelectorAll<HTMLElement>('[data-track-id]') ?? [],
      ).find((element) => element.dataset.trackId === details);
      record?.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
    return () => cancelAnimationFrame(frame);
  }, [details]);
  if (selectedTrack?.sharedRoute && !editShared)
    return (
      <SharedTrackDetails
        track={selectedTrack}
        onBack={() => t.select(null)}
        onEdit={() => setEditShared(true)}
        onShow={onShow}
        onNavigate={() => onNavigate(selectedTrack.id)}
        onShare={() => onShare(selectedTrack.id)}
        error={navigationError}
        photos={
          <TrackPhotoGallery
            track={selectedTrack}
            photos={photos}
            onOpen={onPhoto}
            onAdd={() => onAddPhotos(selectedTrack.id)}
          />
        }
      />
    );
  return (
    <section ref={section} className="track-panel" aria-label="轨迹管理">
      <div className="track-start-actions">
        <button
          className="route-primary"
          onClick={() => {
            if (t.startNew(name)) {
              setName('');
              onDraw();
            }
          }}
        >
          新建轨迹
        </button>
        <button
          className="track-continue-toggle"
          aria-expanded={selectedTrack || selectedDraft ? undefined : choosing}
          aria-controls={
            selectedTrack || selectedDraft ? undefined : 'track-continue-picker'
          }
          title={selectedTrack ? `继续 ${selectedTrack.name}` : undefined}
          onClick={() => {
            if (selectedDraft) {
              t.start();
              onDraw(t.draft.at(-1)?.at(-1));
            } else if (selectedTrack) {
              if (t.continueTrack(selectedTrack.id))
                onDraw(selectedTrack.segments.at(-1)?.at(-1));
            } else setChoosing(!choosing);
          }}
        >
          <History size={14} aria-hidden="true" />
          继续绘制
          {selectedTrack || selectedDraft ? (
            <Play size={14} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} aria-hidden="true" />
          )}
        </button>
      </div>
      {selectedTrack && (
        <button
          className="primary"
          onClick={() => onNavigate(selectedTrack.id)}
        >
          导航所选轨迹
        </button>
      )}
      {navigationError && (
        <p className="route-error" role="alert">
          {navigationError}
        </p>
      )}
      {choosing && !selectedTrack && !selectedDraft && (
        <div id="track-continue-picker" className="track-continue-picker">
          <label htmlFor="continue-track">选择要继续绘制的轨迹</label>
          <select
            id="continue-track"
            value={canContinue ? continueId : ''}
            onChange={(e) => setContinueId(e.target.value)}
          >
            <option value="">请选择轨迹</option>
            {!!t.draft.length && (
              <option value="draft">
                当前未完成草稿 · {formatDistance(trackDistance(t.draft))}
              </option>
            )}
            {records.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name} · {formatDistance(trackDistance(track.segments))}
              </option>
            ))}
          </select>
          {continuation && (
            <small className="track-continue-meta">
              {drawingTime(continuation.createdAt)} · 起点附近：
              {drawingArea(continuation)}
            </small>
          )}
          {!records.length && !t.draft.length && (
            <p className="route-note">暂无可续画轨迹，请先新建。</p>
          )}
          <button
            className="route-primary track-continue-start"
            disabled={!canContinue}
            onClick={() => {
              if (!canContinue) return;
              if (continueId === 'draft') {
                t.start();
                onDraw(t.draft.at(-1)?.at(-1));
              } else if (t.continueTrack(continueId)) {
                onDraw(
                  records
                    .find((track) => track.id === continueId)
                    ?.segments.at(-1)
                    ?.at(-1),
                );
              }
            }}
          >
            <Play size={14} aria-hidden="true" />
            继续所选轨迹
          </button>
        </div>
      )}
      <p className="route-note">
        完成时自动保存时间与起点附近位置。逐点松手连线，双指控图；吸附默认开启。
      </p>
      {t.error && (
        <p className="route-error" role="alert">
          {t.error}
        </p>
      )}
      <label className="track-snap">
        <input
          type="checkbox"
          checked={t.roadSnapping}
          onChange={(e) => t.setRoadSnapping(e.target.checked)}
        />
        道路吸附
        <span>逐点沿路连接；断路时直线跨越，下个点继续吸附</span>
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
        <summary>线条样式</summary>
        <TrackStyleControls style={t.style} onChange={t.setStyle} />
      </details>
      <details className="track-settings">
        <summary>更多吸附 · {t.riverSnapping ? '河流已开启' : '河流'}</summary>
        <label className="track-snap">
          <input
            type="checkbox"
            checked={t.riverSnapping}
            onChange={(e) => t.setRiverSnapping(e.target.checked)}
          />
          河流吸附
          <span>
            默认关闭；开启后只沿河流、溪流和运河中心线，停用道路吸附。
          </span>
        </label>
        <small>
          依赖当前地图的水系线数据；请放大地图。水面没有中心线或水系断开时不自动跨越，需关闭吸附再手动连接。
        </small>
      </details>
      {!!t.draft.length && (
        <>
          <div className="route-result" data-track-id="draft">
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
            <button onClick={() => onEditNodes('draft')}>调整节点</button>
            <button disabled={!t.canUndo} onClick={t.undo}>
              撤销
            </button>
            <button onClick={t.clearDraft}>
              {t.editingId ? '放弃本次续画' : '清空草稿'}
            </button>
          </div>
          <SmartInput
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
              }
            }}
          >
            {t.editingId ? '保存整条线路' : '保存到本机'}
          </button>
        </>
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
      {records.map((track) => (
        <div
          className="track-record"
          key={track.id}
          data-track-id={track.id}
          data-selected={details === track.id}
        >
          <div className="track-saved">
            <button
              className="track-open"
              onClick={() => {
                t.setVisible(true);
                t.select(track.id);
                if (onOpen) onOpen(track.id);
                else onShow(track.segments.flat());
              }}
            >
              <strong>{track.name}</strong>
              <small>
                {trackSourceLabel(track)} ·{' '}
                {formatDistance(trackDistance(track.segments))}
              </small>
              <small>
                {drawingTime(track.createdAt)} · {drawingArea(track)}
              </small>
            </button>
            <button
              onClick={() => t.showTrack(track.id, !!track.hidden)}
              aria-label={`${track.hidden ? '显示' : '隐藏'}路线 ${track.name}`}
            >
              {track.hidden ? '显示' : '隐藏'}
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
              className="track-navigate"
              onClick={() => onNavigate(track.id)}
              aria-label={`导航 ${track.name}`}
            >
              导航
            </button>
            <button
              onClick={() => onShare(track.id)}
              aria-label={`分享 ${track.name}`}
            >
              分享
            </button>
            <button
              disabled={keepsOriginalPoints(track) || t.editingId === track.id}
              onClick={() => onEditNodes(track.id)}
              title={
                keepsOriginalPoints(track)
                  ? '原始记录受保护，请先复制为手绘'
                  : undefined
              }
            >
              调整节点
            </button>
            <button
              onClick={() => setDetails(details === track.id ? null : track.id)}
            >
              {details === track.id ? '收起详情' : '统计 / 天气 / 样式'}
            </button>
            <button
              onClick={() => {
                if (t.continueTrack(track.id)) {
                  setName(
                    keepsOriginalPoints(track)
                      ? `${track.name} · 手绘副本`
                      : track.name,
                  );
                  setDetails(null);
                  onDraw(track.segments.at(-1)?.at(-1));
                }
              }}
            >
              {keepsOriginalPoints(track) ? '复制为手绘' : '续画'}
            </button>
          </div>
          {details === track.id && (
            <>
              <TrackPhotoGallery
                track={track}
                photos={photos}
                onOpen={onPhoto}
                onAdd={() => onAddPhotos(track.id)}
              />
              {track.sharedRoute && (
                <div className="route-note">
                  {track.sharedRoute.stops.map((s, i) => (
                    <div key={i}>
                      {i === 0
                        ? '起点'
                        : i === track.sharedRoute!.stops.length - 1
                          ? '终点'
                          : `途经 ${i}`}
                      ：{s.name}
                      <br />
                      {s.coordinates[1].toFixed(6)}°,{' '}
                      {s.coordinates[0].toFixed(6)}°
                    </div>
                  ))}
                  <p>
                    {track.sharedRoute.tolerance > 0
                      ? `二维码线形已简化（约 ${track.sharedRoute.tolerance} 米），海拔沿当前线形重新采样。完整精度请另导入 GPX/KML。`
                      : '海拔由地形数据采样；未缓存地形时需联网加载。'}
                  </p>
                  <JourneyPanel
                    segments={track.segments}
                    onLocate={(p) => onShow([p])}
                  />
                </div>
              )}
              <label className="track-rename">
                线路名称
                <SmartInput
                  className="track-name"
                  defaultValue={track.name}
                  maxLength={60}
                  onBlur={(event) => {
                    t.rename(track.id, event.target.value);
                    if (!event.target.value.trim())
                      event.target.value = track.name;
                  }}
                />
              </label>
              <p className="route-note">
                {trackSourceLabel(track)}
                {hasTrackTime(track) ? ' · 可匹配照片' : ' · 无拍摄时间轴'}
                <br />
                {track.segments.length} 段 ·{' '}
                {track.segments.reduce((n, line) => n + line.length, 0)} 个节点
                <br />
                创建于 {new Date(track.createdAt).toLocaleString('zh-CN')}
                {track.updatedAt && (
                  <> · 更新于 {drawingTime(track.updatedAt)}</>
                )}
                <br />
                起点附近：{drawingArea(track)}
                <br />
                {keepsOriginalPoints(track)
                  ? '原始坐标和时间受保护；重命名或改线条样式不会改变记录。'
                  : '点选节点出现选中圈，再按住圈直接拖动；松手保存，可撤销。'}
              </p>
              <button
                disabled={
                  keepsOriginalPoints(track) ||
                  t.nodeUndoId !== track.id ||
                  t.editingId === track.id
                }
                onClick={t.undoNodeMove}
              >
                撤销节点移动
              </button>
              <TrackStyleControls
                style={normalizeTrackStyle(track.style)}
                onChange={(style) => t.updateStyle(track.id, style)}
              />
              {!track.sharedRoute && (
                <JourneyPanel
                  segments={track.segments}
                  onLocate={(p) => onShow([p])}
                />
              )}
            </>
          )}
          {details === track.id && (
            <div className="route-edit-actions">
              <button
                disabled={keepsOriginalPoints(track) || !!t.draft.length}
                onClick={() => t.reverseTrack(track.id)}
              >
                交换起终点
              </button>
              <button
                disabled={keepsOriginalPoints(track) || !!t.draft.length}
                onClick={() => t.mergeTrack(track.id)}
              >
                合并相接线路
              </button>
            </div>
          )}
        </div>
      ))}
      <p className="route-note">
        已显示的道路可直接吸附；虚线预览表示此段直线跨越断路，松手后继续沿路。吸附不代表道路当前可通行，轨迹只存本机。
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
      <button aria-pressed={t.roadSnapping} onClick={() => t.setRoadSnapping(!t.roadSnapping)}>
        道路吸附
      </button>
      <button aria-pressed={t.riverSnapping} onClick={() => t.setRiverSnapping(!t.riverSnapping)}>
        河流吸附
      </button>
      <button aria-pressed={t.snapping} onClick={() => t.setSnapping(!t.snapping)}>
        节点吸附
      </button>
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
