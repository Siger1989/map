import { useEffect, useState } from 'react';
import { ArrowLeftRight, CornerUpRight, MapPin, Trash2, X } from 'lucide-react';
import {
  moveSurveyStation,
  surveyCoordinate,
  surveyStations,
} from './surveyLine';
import { surveyPointInput } from './surveyPointInput';
import type { SurveySectionState } from './useSurveySection';

/** Point-scoped form; remounted for each point so drafts cannot reach another point. */
export function SurveyPointEditor({
  state,
  onDetails,
  onDelete,
}: {
  state: SurveySectionState;
  onDetails: () => void;
  onDelete: () => void;
}) {
  const line = state.object!.settings.survey!;
  const station = surveyStations(line).find((s) => s.id === state.selected)!;
  const coordinate = surveyCoordinate(line, station.distance);
  const [lng, setLng] = useState(coordinate[0].toFixed(6));
  const [lat, setLat] = useState(coordinate[1].toFixed(6));
  const [error, setError] = useState('');
  useEffect(() => {
    setLng(coordinate[0].toFixed(6));
    setLat(coordinate[1].toFixed(6));
    setError('');
  }, [coordinate[0], coordinate[1]]);
  const baseline = station.id === 'A' || station.id === 'B';
  const moving = state.picking === station.id || state.dragging;
  return (
    <section
      className="survey-point-editor"
      aria-label={`${station.label} 点位编辑`}
    >
      <header>
        <strong>
          {station.label} 点 · {baseline ? '基准点' : '沿线点'}
        </strong>
        <button onClick={onDetails} aria-label={`${station.label} 点资料`}>
          资料
        </button>
        <button
          className="survey-delete"
          onClick={onDelete}
          disabled={baseline}
          title={
            baseline
              ? 'A/B 用于确定方向，请修改坐标或重选'
              : '从剖面删除，关联标记保留在地图'
          }
          aria-label={`删除 ${station.label} 点`}
        >
          <Trash2 size={14} />
          删点
        </button>
        <button onClick={state.hidePointMenu} aria-label="关闭点位菜单">
          <X size={18} />
        </button>
      </header>
      <div className="survey-point-scroll">
        {moving ? (
          <div className="survey-move-hint">
            <p role={state.error ? 'alert' : 'status'}>
              {state.error || (
                <>
                  移动 {station.label}：
                  {baseline && state.mode === 'direction'
                    ? '调整方向'
                    : '沿线移动'}
                  。拖动点，或点击地图指定位置。
                </>
              )}
            </p>
            <button
              onClick={() => {
                state.cancelPreview();
                state.setPicking(null);
              }}
            >
              取消移动
            </button>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const p = surveyPointInput(lng, lat);
                const next = moveSurveyStation(
                  line,
                  station.id,
                  p,
                  state.mode,
                  state.follow,
                );
                if (state.editPoint(station.id, p, true)) {
                  const actual = surveyCoordinate(
                    next,
                    surveyStations(next).find((s) => s.id === station.id)!
                      .distance,
                  );
                  setLng(actual[0].toFixed(6));
                  setLat(actual[1].toFixed(6));
                  setError('');
                  (document.activeElement as HTMLElement | null)?.blur();
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : '坐标无效');
              }
            }}
          >
            <div className="survey-coordinate-fields">
              <label>
                <span title="WGS84 十进制度">经</span>
                <input
                  aria-label="剖面点经度"
                  inputMode="decimal"
                  value={lng}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setLng(e.target.value);
                    setError('');
                  }}
                />
              </label>
              <label>
                <span title="WGS84 十进制度">纬</span>
                <input
                  aria-label="剖面点纬度"
                  inputMode="decimal"
                  value={lat}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setLat(e.target.value);
                    setError('');
                  }}
                />
              </label>
            </div>
            {(error || state.error) && (
              <p role="alert">{error || state.error}</p>
            )}
            <button
              type="submit"
              className="survey-apply"
              aria-label="应用坐标"
            >
              应用
            </button>
          </form>
        )}
        <div className="survey-point-modes" aria-label="点位编辑方式">
          {baseline && (
            <button
              aria-pressed={state.mode === 'direction'}
              onClick={() => state.beginMove(station.id, 'direction')}
            >
              <CornerUpRight size={17} />
              调方向
            </button>
          )}
          <button
            aria-pressed={!baseline || state.mode === 'slide'}
            onClick={() => state.beginMove(station.id, 'slide')}
          >
            <ArrowLeftRight size={17} />
            沿线移动
          </button>
          <button
            className="survey-reselect"
            aria-label="从已有标记重选"
            onClick={() => state.setPicking(station.id)}
          >
            <MapPin size={17} />
            已有标记
          </button>
        </div>
      </div>
    </section>
  );
}
