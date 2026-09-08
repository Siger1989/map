import type { AreasState } from './useAreas';
import { areaMetrics } from './data';
import { AnnotationIdentity } from '../annotations/AnnotationIdentity';
import {
  ATTRIBUTE_TEMPLATE_KEY,
  readAttributeTemplate,
  rememberAttributes,
} from '../annotations/attributes';
import { useState } from 'react';
import './areas.css';
export function AreaTools({
  state,
  onFinish,
  onHide,
  onExtrude,
}: {
  state: AreasState;
  onFinish: () => void;
  onHide: () => void;
  onExtrude: (height: number) => string | null;
}) {
  const item = state.items.find((a) => a.id === state.selected);
  const [removing, setRemoving] = useState(false),
    [notice, setNotice] = useState('');
  const [height, setHeight] = useState('20');
  if (state.drawing)
    return (
      <section className="area-drawing-tools glass" aria-label="划区域工具">
        <strong>划区域 · {state.draft.length} 点</strong>
        <label>
          <input
            type="checkbox"
            checked={state.roadSnapping}
            onChange={(e) => state.setRoadSnapping(e.target.checked)}
          />
          道路吸附
        </label>
        <div>
          <button onClick={state.undoDraft}>撤销点</button>
          <button disabled={state.draft.length < 3} onClick={onFinish}>
            闭合区域
          </button>
          <button onClick={state.cancel}>取消</button>
        </div>
        {state.error && <p role="status">{state.error}</p>}
      </section>
    );
  if (!item) return null;
  const metrics = areaMetrics(item.boundary);
  return (
    <section
      className="area-editor glass annotation-panel"
      aria-label="区域编辑"
    >
      <header>
        <strong>
          区域 ·{' '}
          {metrics.area >= 1e6
            ? (metrics.area / 1e6).toFixed(2) + ' km²'
            : metrics.area.toFixed(0) + ' m²'}
        </strong>
        <button aria-label="关闭区域编辑" onClick={onHide}>
          ×
        </button>
      </header>
      <div className="annotation-fields">
        <AnnotationIdentity
          item={item}
          change={(patch) => state.update(item.id, patch)}
          remember={() => {
            try {
              localStorage.setItem(
                ATTRIBUTE_TEMPLATE_KEY,
                JSON.stringify(
                  rememberAttributes(
                    readAttributeTemplate(
                      localStorage.getItem(ATTRIBUTE_TEMPLATE_KEY),
                    ),
                    item.attributes ?? [],
                  ),
                ),
              );
            } catch {
              setNotice('属性已在区域中保存，模板保存失败');
            }
          }}
        />
        <label className="annotation-field">
          颜色
          <input
            type="color"
            value={item.color}
            onChange={(e) => state.update(item.id, { color: e.target.value })}
          />
        </label>
        <div className="annotation-grid">
          <label className="annotation-field">
            拉伸高度（米）
            <input
              aria-label="拉伸高度"
              type="number"
              min="0.1"
              max="10000"
              value={height}
              onChange={(e) => setHeight(e.target.value)}
            />
          </label>
          <button onClick={() => setNotice(onExtrude(Number(height)) ?? '')}>
            拉伸成模型
          </button>
        </div>
        <div className="annotation-actions">
          <button onClick={onHide}>收起编辑，长按调点</button>
          <button disabled={!state.canUndo} onClick={state.undoMove}>
            撤销移动
          </button>
        </div>
        <label>
          <input
            type="checkbox"
            checked={item.visible}
            onChange={(e) =>
              state.update(item.id, { visible: e.target.checked })
            }
          />
          显示区域
        </label>
        <p>
          周长约 {metrics.perimeter.toFixed(0)} m ·
          球面面积估算。闭合边界点可长按拖动，双指取消。
        </p>
        <button
          onClick={() => {
            if (removing) state.remove(item.id);
            else setRemoving(true);
          }}
        >
          {removing ? '确认删除区域' : '删除区域'}
        </button>
        {(state.error || notice) && (
          <p role="status">{state.error || notice}</p>
        )}
      </div>
    </section>
  );
}
