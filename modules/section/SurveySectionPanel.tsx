import { useMemo, useState } from 'react';
import { X, Plus, MapPin, Image, RefreshCw, Bookmark } from 'lucide-react';
import type { Annotation } from '../annotations/data';
import { deliverPhoto } from '../photos/export';
import { surveyDrawing } from './surveyDrawing';
import { sectionImageName } from './exportName';
import {
  emptySurveyInfo,
  removeSurveyStation,
  surveyCoordinate,
  surveyHeight,
  surveySettings,
  surveyStations,
  type SurveySheetInfo,
  type SurveyPointData,
} from './surveyLine';
import { surveyPointData } from './surveyRecords';
import type { SurveySectionState } from './useSurveySection';
import './survey.css';

export function SurveySectionPanel({
  state,
  markers,
  onMarker,
  onLocate,
  onFavorites,
}: {
  state: SurveySectionState;
  markers: Annotation[];
  onMarker: (id: string) => void;
  onLocate: (coordinate: [number, number]) => void;
  onFavorites: () => void;
}) {
  const [sheet, setSheet] = useState(false),
    [zoom, setZoom] = useState(1),
    [exporting, setExporting] = useState(false),
    [message, setMessage] = useState('');
  const [info, setInfo] = useState<SurveySheetInfo | null>(null);
  const [pointInfo, setPointInfo] = useState<
      (SurveyPointData & { id: string }) | null
    >(null),
    [deletePoint, setDeletePoint] = useState<{
      id: string;
      label: string;
    } | null>(null),
    [page, setPage] = useState(0);
  const object = state.object,
    line = object?.settings.survey,
    terrain = object?.settings.surveyTerrain;
  const stations = line ? surveyStations(line) : [],
    selected = stations.find((s) => s.id === state.selected);
  const drawing = useMemo(() => {
    if (!line || !terrain || !sheet) return null;
    try {
      return surveyDrawing(line, terrain, object!.name, markers);
    } catch (e) {
      return { error: e instanceof Error ? e.message : '剖面图无法生成' };
    }
  }, [line, terrain, sheet, object?.name, markers]);
  const selectedMarker = markers.find((a) => a.id === state.selected);
  const pointData = line
    ? surveyPointData(line, state.selected, selected?.label ?? '', markers)
    : { name: '', note: '' };
  const savePoint = ({ id, ...data }: SurveyPointData & { id: string }) =>
    line && object && stations.some((s) => s.id === id)
      ? state.commit(
          surveySettings(
            {
              ...line,
              pointData: { ...line.pointData, [id]: data },
            },
            object.settings,
          ),
        )
      : false;
  const imagePage =
    drawing && 'pages' in drawing
      ? drawing.pages[Math.min(page, drawing.pages.length - 1)]
      : null;
  const hint =
    state.picking === 'first'
      ? '选 A：点地图或已有标记'
      : state.picking === 'second'
        ? '选 B：点地图或已有标记'
        : state.picking === 'point'
          ? '点地图添加测点，自动吸附到勘探线'
          : state.picking === 'marker'
            ? '点地图添加标记，自动吸附到勘探线'
            : state.picking
              ? `重选 ${selected?.label ?? state.picking}：${state.mode === 'direction' && ['A', 'B'].includes(state.picking) ? '调整方向' : '沿线滑动'}`
              : '选中点后拖动，或按“重选”点地图';
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
        new File([blob], sectionImageName(page), { type: 'image/jpeg' }),
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
    <>
      <section className="survey-panel" aria-label="勘探线剖面编辑">
        <header>
          <strong>
            {info
              ? '图纸信息'
              : pointInfo
                ? '点位资料'
                : (object?.name ?? '新建勘探线剖面')}
          </strong>
          {line && !info && !pointInfo && (
            <button
              onClick={() => setInfo({ ...emptySurveyInfo(), ...line.info })}
            >
              信息
            </button>
          )}
          <button onClick={state.close} aria-label="关闭勘探线剖面">
            <X size={16} />
          </button>
        </header>
        <div className="survey-panel-body">
          {pointInfo && (
            <div className="survey-info-fields">
              <label>
                名称
                <input
                  aria-label="剖面点名称"
                  maxLength={60}
                  value={pointInfo.name}
                  onChange={(e) =>
                    setPointInfo({ ...pointInfo, name: e.target.value })
                  }
                />
              </label>
              <label>
                备注
                <input
                  aria-label="剖面点备注"
                  maxLength={500}
                  value={pointInfo.note}
                  onChange={(e) =>
                    setPointInfo({ ...pointInfo, note: e.target.value })
                  }
                />
              </label>
            </div>
          )}
          <div hidden={!!pointInfo}>
            {info ? (
              <div className="survey-info-fields">
                {(
                  [
                    ['project', '项目名称'],
                    ['title', '图名'],
                    ['number', '图号'],
                    ['author', '编制人'],
                    ['reviewer', '审核人'],
                    ['date', '编制日期'],
                    ['source', '资料来源补充'],
                    ['note', '图纸备注'],
                  ] as [keyof SurveySheetInfo, string][]
                ).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type={key === 'date' ? 'date' : 'text'}
                      aria-label={label}
                      value={info[key]}
                      maxLength={key === 'note' ? 500 : 100}
                      onChange={(e) =>
                        setInfo({ ...info, [key]: e.target.value })
                      }
                    />
                  </label>
                ))}
              </div>
            ) : (
              <>
                <p role="status">{hint}</p>
                {line && (
                  <>
                    <nav aria-label="剖面沿线点" className="survey-point-tabs">
                      {stations.map((s) => (
                        <button
                          key={s.id}
                          aria-pressed={state.selected === s.id}
                          onClick={() => {
                            state.select(s.id);
                            state.setPicking(null);
                          }}
                        >
                          {s.label}
                        </button>
                      ))}
                    </nav>
                    {selected && (
                      <div className="survey-point-tools">
                        {['A', 'B'].includes(selected.id) ? (
                          <select
                            aria-label="基准点编辑方式"
                            value={state.mode}
                            onChange={(e) =>
                              state.setMode(
                                e.target.value as 'direction' | 'slide',
                              )
                            }
                          >
                            <option value="direction">调整方向</option>
                            <option value="slide">仅沿线滑动</option>
                          </select>
                        ) : (
                          <span>仅沿线滑动</span>
                        )}
                        <button onClick={() => state.setPicking(selected.id)}>
                          重选 {selected.label}
                        </button>
                        <button
                          onClick={() =>
                            onLocate(surveyCoordinate(line, selected.distance))
                          }
                        >
                          定位
                        </button>
                        <button
                          onClick={() =>
                            setPointInfo({ ...pointData, id: selected.id })
                          }
                        >
                          资料
                        </button>
                        {selectedMarker && (
                          <button onClick={() => onMarker(selectedMarker.id)}>
                            照片/标记
                          </button>
                        )}
                        {!['A', 'B'].includes(selected.id) && (
                          <button
                            onClick={() =>
                              setDeletePoint({
                                id: selected.id,
                                label: selected.label,
                              })
                            }
                          >
                            删点
                          </button>
                        )}
                        <span>
                          {selected.distance.toFixed(1)} m ·{' '}
                          {terrain
                            ? (surveyHeight(
                                terrain,
                                selected.distance,
                              )?.toFixed(1) ?? '—')
                            : '—'}{' '}
                          m 高程
                        </span>
                      </div>
                    )}
                    <label>
                      等高距
                      <select
                        value={line.interval}
                        aria-label="剖面等高距"
                        onChange={(e) =>
                          state.commit(
                            surveySettings(
                              { ...line, interval: Number(e.target.value) },
                              object!.settings,
                            ),
                          )
                        }
                      >
                        {[1, 2, 5, 10, 20, 25, 50, 100, 200, 500].map((v) => (
                          <option key={v} value={v}>
                            {v} m
                          </option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
                {state.busy && <p role="status">正在读取地形与等高线…</p>}
                {state.error && <p role="alert">{state.error}</p>}
              </>
            )}
          </div>
          {(info || pointInfo) && state.error && (
            <p role="alert">{state.error}</p>
          )}
          {deletePoint && line && (
            <div>
              <p>从剖面移除 {deletePoint.label}？关联标记保留在地图。</p>
              <button
                onClick={() => {
                  if (
                    state.commit(
                      surveySettings(
                        removeSurveyStation(line, deletePoint.id),
                        object!.settings,
                      ),
                    )
                  ) {
                    state.select('A');
                    setDeletePoint(null);
                  }
                }}
              >
                移除点
              </button>
              <button onClick={() => setDeletePoint(null)}>取消</button>
            </div>
          )}
        </div>
        <footer>
          {pointInfo ? (
            <>
              <button
                onClick={() => {
                  if (savePoint(pointInfo)) setPointInfo(null);
                }}
              >
                保存资料
              </button>
              <button onClick={() => setPointInfo(null)}>返回</button>
            </>
          ) : info && line ? (
            <>
              <button
                onClick={() => {
                  if (
                    state.commit(
                      surveySettings({ ...line, info }, object!.settings),
                    )
                  )
                    setInfo(null);
                }}
              >
                保存信息
              </button>
              <button onClick={() => setInfo(null)}>返回</button>
            </>
          ) : line ? (
            <>
              <button onClick={() => state.setPicking('point')}>
                <Plus size={14} />
                加点
              </button>
              <button onClick={() => state.setPicking('marker')}>
                <MapPin size={14} />
                标记
              </button>
              <button
                disabled={!terrain}
                onClick={() => {
                  setSheet(true);
                  setZoom(1);
                  setPage(0);
                }}
              >
                <Image size={14} />
                平剖图
              </button>
              <button onClick={onFavorites}>
                <Bookmark size={14} />
                已收藏
              </button>
              <button
                disabled={state.busy}
                onClick={state.retry}
                aria-label="重试地形采样"
              >
                <RefreshCw size={14} />
              </button>
            </>
          ) : (
            <button onClick={state.start}>重选 A/B</button>
          )}
          {state.picking && line && (
            <button onClick={() => state.setPicking(null)}>取消</button>
          )}
        </footer>
      </section>
      {sheet && (
        <section
          className="survey-sheet"
          role="dialog"
          aria-modal="true"
          aria-label="勘探线平剖图"
        >
          <header>
            <strong>平剖图</strong>
            <button
              onClick={() => setZoom((n) => Math.max(1, n - 0.5))}
              aria-label="缩小图纸"
            >
              −
            </button>
            <button
              onClick={() => setZoom((n) => Math.min(6, n + 0.5))}
              aria-label="放大图纸"
            >
              +
            </button>
            <button onClick={() => setZoom(1)}>全图</button>
            <button
              disabled={exporting || !drawing || !('svg' in drawing)}
              onClick={() => void exportImage(false)}
            >
              保存图片
            </button>
            <button
              disabled={exporting || !drawing || !('svg' in drawing)}
              onClick={() => void exportImage(true)}
            >
              分享
            </button>
            <button onClick={() => setSheet(false)} aria-label="关闭平剖图">
              <X size={16} />
            </button>
          </header>
          {drawing && 'pages' in drawing && (
            <nav>
              <button
                disabled={page === 0}
                onClick={() => setPage((n) => n - 1)}
              >
                上一页
              </button>
              <span>
                第 {page + 1}/{drawing.pages.length} 页 ·{' '}
                {page === 0 ? '平剖图' : '完整资料附表'}
              </span>
              <button
                disabled={page >= drawing.pages.length - 1}
                onClick={() => setPage((n) => n + 1)}
              >
                下一页
              </button>
              <small>保存/分享当前页</small>
            </nav>
          )}
          <div className="survey-sheet-scroll">
            {imagePage ? (
              <img
                alt={
                  page === 0
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
              <p role="alert">
                {drawing && 'error' in drawing ? drawing.error : '地形尚未就绪'}
              </p>
            )}
          </div>
          {message && <p role="status">{message}</p>}
        </section>
      )}
    </>
  );
}
