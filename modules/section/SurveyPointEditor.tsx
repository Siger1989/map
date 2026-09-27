import { useEffect, useState } from 'react';
import { ArrowLeftRight, CornerUpRight, Trash2 } from 'lucide-react';
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
  const beginMove = (mode: 'direction' | 'slide') => {
    setLng(coordinate[0].toFixed(6));
    setLat(coordinate[1].toFixed(6));
    setError('');
    state.beginMove(station.id, mode);
  };
  return (
    <section
      className="survey-point-editor"
      aria-label={`${station.label} 点位编辑`}
    >
      <div className="survey-point-scroll">
        {moving ? (
          <div className="survey-live-coordinate-row" aria-label="实时移动坐标">
            <div className="survey-coordinate-fields">
              <label>
                <span title="WGS84 十进制度">经</span>
                <output aria-label="移动点经度">
                  {coordinate[0].toFixed(6)}
                </output>
              </label>
              <label>
                <span title="WGS84 十进制度">纬</span>
                <output aria-label="移动点纬度">
                  {coordinate[1].toFixed(6)}
                </output>
              </label>
            </div>
            <button
              aria-label="取消移动"
              onClick={() => {
                state.cancelPreview();
                state.setPicking(null);
              }}
            >
              取消
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
            <button
              type="submit"
              className="survey-apply"
              aria-label="应用坐标"
            >
              应用
            </button>
          </form>
        )}
        {(error || state.error) && (
          <p className="survey-point-error" role="alert">
            {error || state.error}
          </p>
        )}
        {!moving && (
          <div className="survey-point-modes" aria-label="点位编辑方式">
            <button onClick={onDetails} aria-label={`${station.label} 点资料`}>
              资料
            </button>
            {baseline && (
              <button
                aria-pressed={state.mode === 'direction'}
                onClick={() => beginMove('direction')}
              >
                <CornerUpRight size={17} />
                移动基准点
              </button>
            )}
            {!baseline && (
              <button
                className="survey-delete"
                onClick={onDelete}
                title="从剖面删除，关联标记保留在地图"
                aria-label={`删除 ${station.label} 点`}
              >
                <Trash2 size={14} />
                删点
              </button>
            )}
            <button
              aria-pressed={!baseline || state.mode === 'slide'}
              onClick={() => beginMove('slide')}
            >
              <ArrowLeftRight size={17} />
              沿线移动
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
