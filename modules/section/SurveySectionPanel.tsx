import { useState } from 'react';
import {
  ChevronLeft,
  FileText,
  Plus,
  MapPin,
  Check,
  X,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import type { Annotation } from '../annotations/data';
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
import { SurveyPointEditor } from './SurveyPointEditor';
import { AnnotationTypeOptions } from '../annotations/AnnotationTypeOptions';
import { SurveySheet } from './SurveySheet';
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
    [info, setInfo] = useState<SurveySheetInfo | null>(null);
  const [deleteWhole, setDeleteWhole] = useState(false);
  const [pointDraft, setPointInfo] = useState<
    (SurveyPointData & { id: string }) | null
  >(null);
  const [deleteDraft, setDeletePoint] = useState<{
    id: string;
    label: string;
  } | null>(null);
  // Keep map drafts when viewing a sheet, without showing them as sheet fields.
  const pointInfo = sheet ? null : pointDraft,
    deletePoint = sheet ? null : deleteDraft;
  const object = state.object,
    line = object?.settings.survey,
    terrain = object?.settings.surveyTerrain;
  const stations = line ? surveyStations(line) : [],
    selected = stations.find((s) => s.id === state.selected);
  const detailsStation = stations.find((s) => s.id === pointInfo?.id),
    selectedMarker = markers.find((a) => a.id === pointInfo?.id);
  const pointData = line
    ? surveyPointData(line, state.selected, selected?.label ?? '', markers)
    : { name: '', note: '' };
  const savePoint = ({ id, ...data }: SurveyPointData & { id: string }) =>
    line && object && stations.some((s) => s.id === id)
      ? state.commit(
          surveySettings(
            { ...line, pointData: { ...line.pointData, [id]: data } },
            object.settings,
          ),
        )
      : false;
  const hint =
    state.picking === 'first'
      ? '选择 A：点地图或已有标记'
      : state.picking === 'second'
        ? '选择 B：点地图或已有标记'
        : state.picking === 'point'
          ? '点地图添加测点，自动吸附到勘探线'
          : state.picking === 'marker'
            ? '点地图添加标记，自动吸附到勘探线'
            : '点击地图上的点，编辑坐标或移动位置';
  const details = (info || pointInfo || deletePoint) && !state.dragging && (
    <section
      className="survey-panel survey-details"
      aria-label={deletePoint ? '删除沿线点' : info ? '图纸信息' : '点位资料'}
    >
      <header>
        <strong>
          {deletePoint ? '删除沿线点' : info ? '图纸信息' : '点位资料'}
        </strong>
        <button
          aria-label="关闭资料窗口"
          onClick={() => {
            setInfo(null);
            if (!sheet) {
              setPointInfo(null);
              setDeletePoint(null);
            }
          }}
        >
          <X size={16} />
        </button>
      </header>
      <div className="survey-panel-body">
        {deletePoint ? (
          <p>从剖面删除 {deletePoint.label} 点？关联标记仍保留在地图上。</p>
        ) : pointInfo ? (
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
            <p>
              {detailsStation?.distance.toFixed(1)} m 里程 ·{' '}
              {terrain && detailsStation
                ? (surveyHeight(terrain, detailsStation.distance)?.toFixed(1) ??
                  '—')
                : '—'}{' '}
              m 高程
            </p>
          </div>
        ) : (
          info && (
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
          )
        )}
        {state.error && <p role="alert">{state.error}</p>}
      </div>
      <footer>
        {deletePoint && line ? (
          <>
            <button
              className="survey-delete"
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
              确认删除点
            </button>
            <button onClick={() => setDeletePoint(null)}>取消</button>
          </>
        ) : pointInfo ? (
          <>
            <button
              onClick={() => {
                if (savePoint(pointInfo)) setPointInfo(null);
              }}
            >
              保存资料
            </button>
            <button
              onClick={() => {
                if (line && detailsStation)
                  onLocate(surveyCoordinate(line, detailsStation.distance));
              }}
            >
              定位
            </button>
            {selectedMarker && (
              <button onClick={() => onMarker(selectedMarker.id)}>
                照片/标记
              </button>
            )}
            <button onClick={() => setPointInfo(null)}>返回</button>
          </>
        ) : (
          info &&
          line && (
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
          )
        )}
      </footer>
    </section>
  );
  const genericPick = ['first', 'second', 'point', 'marker'].includes(
    state.picking ?? '',
  );
  return (
    <>
      <section className="survey-workbar" aria-label="勘探线剖面编辑">
        <button onClick={state.close} aria-label="关闭勘探线剖面">
          <ChevronLeft size={20} />
        </button>
        <strong>{object?.name ?? '新建勘探线'}</strong>
        {state.busy && (
          <RefreshCw
            size={14}
            className="survey-loading"
            aria-label="正在更新地形"
          />
        )}
        {line && (
          <button
            className="survey-delete"
            aria-label="删除整条剖面"
            onClick={() => {
              state.select(state.selected);
              setDeleteWhole(true);
            }}
          >
            <Trash2 size={16} />
            删除
          </button>
        )}
        {line && (
          <button onClick={() => setSheet(true)}>
            <FileText size={18} />
            图纸
          </button>
        )}
      </section>
      <section className="survey-dock" aria-label="剖面点编辑区">
        {deleteWhole ? (
          <section
            className="survey-panel survey-details"
            aria-label="删除整条剖面确认"
          >
            <header>
              <strong>删除整条剖面？</strong>
              <button
                aria-label="取消删除剖面"
                onClick={() => setDeleteWhole(false)}
              >
                <X size={16} />
              </button>
            </header>
            <div className="survey-panel-body">
              <p>
                删除 {object?.name}{' '}
                的勘探线和图纸；地图标记、钻井和模型保留并解除绑定。
              </p>
              {state.error && <p role="alert">{state.error}</p>}
            </div>
            <footer>
              <button className="survey-delete" onClick={state.remove}>
                确认删除剖面
              </button>
              <button onClick={() => setDeleteWhole(false)}>取消</button>
            </footer>
          </section>
        ) : details && !sheet ? (
          details
        ) : (
          <>
            <div className="survey-dock-content">
              {state.markerTarget ? (
                <div
                  className="survey-marker-types"
                  aria-label="剖面点添加标记"
                >
                  <header>
                    <strong>
                      {state.markerTarget.stationId
                        ? `${selected?.label ?? ''} 点 · 添加标记`
                        : '沿线添加标记'}
                    </strong>
                    <button
                      aria-label="取消剖面添加标记"
                      onClick={state.cancelMarker}
                    >
                      <X size={16} />
                    </button>
                  </header>
                  <div>
                    <AnnotationTypeOptions onAdd={state.createMarker} />
                  </div>
                  {state.error && <p role="alert">{state.error}</p>}
                </div>
              ) : state.pointMenu && selected && line && !genericPick ? (
                <SurveyPointEditor
                  key={selected.id}
                  state={state}
                  onDetails={() =>
                    setPointInfo({ ...pointData, id: selected.id })
                  }
                  onDelete={() =>
                    setDeletePoint({ id: selected.id, label: selected.label })
                  }
                />
              ) : (
                <div className="survey-pick-hint">
                  <p role="status">{hint}</p>
                  {state.picking && line && (
                    <button onClick={() => state.setPicking(null)}>
                      取消选点
                    </button>
                  )}
                  {state.error && <p role="alert">{state.error}</p>}
                </div>
              )}
            </div>
            <div className="survey-action-row" aria-label="勘探线编辑操作">
              {line ? (
                <>
                  <button
                    aria-pressed={state.picking === 'point'}
                    onClick={() => state.setPicking('point')}
                  >
                    <Plus size={18} />
                    加点
                  </button>
                  <button
                    aria-pressed={state.picking === 'marker'}
                    onClick={state.requestMarker}
                  >
                    <MapPin size={18} />
                    添加标记
                  </button>
                  <button className="survey-primary" onClick={state.close}>
                    <Check size={18} />
                    完成编辑
                  </button>
                </>
              ) : (
                <>
                  <button onClick={state.start}>重选 A/B</button>
                  <button onClick={state.close}>取消新建</button>
                </>
              )}
            </div>
          </>
        )}
      </section>
      {sheet && line && (
        <SurveySheet
          state={state}
          markers={markers}
          onInfo={() => setInfo({ ...emptySurveyInfo(), ...line.info })}
          onClose={() => setSheet(false)}
          onFavorites={onFavorites}
        />
      )}
      {sheet && info && <div className="survey-info-modal">{details}</div>}
    </>
  );
}
