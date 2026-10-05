import type { AreasState } from './useAreas';
import { areaMetrics } from './data';
import { AnnotationIdentity } from '../annotations/AnnotationIdentity';
import {
  ATTRIBUTE_TEMPLATE_KEY,
  readAttributeTemplate,
  rememberAttributes,
} from '../annotations/attributes';
import { useState } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import {
  AREA_DISPLAY_UNITS,
  formatAreaValue,
  readAreaDisplayUnit,
  writeAreaDisplayUnit,
  type AreaDisplayUnit,
} from './areaDisplayUnits';
import './areas.css';
export function AreaTools({
  state,
  onFinish,
  onHide,
}: {
  state: AreasState;
  onFinish: () => void;
  onHide: () => void;
}) {
  const item = state.items.find((a) => a.id === state.selected);
  const [removing, setRemoving] = useState(false),
    [notice, setNotice] = useState('');
  const [areaUnit, setAreaUnit] = useState<AreaDisplayUnit>(readAreaDisplayUnit);
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
      className="area-editor glass"
      aria-label="区域编辑"
    >
      <header>
        <strong title={item.name}>{item.name || '区域'}</strong>
        <label className="area-area-summary">
          <output aria-label="区域面积">{formatAreaValue(metrics.area, areaUnit)}</output>
          <select className="area-area-unit" aria-label="面积单位" value={areaUnit} onChange={event => {
            const next = event.target.value as AreaDisplayUnit;
            setAreaUnit(next);
            writeAreaDisplayUnit(next);
          }}>
            {AREA_DISPLAY_UNITS.map(unit => <option key={unit.id} value={unit.id}>{unit.label}</option>)}
          </select>
        </label>
        <button className="area-delete" aria-label={removing ? '取消删除区域' : '删除区域'} title="删除区域" onClick={() => setRemoving(value => !value)}>
          <Trash2 size={14}/>
        </button>
        <button className="area-close" aria-label="关闭区域编辑" title="关闭区域编辑" onClick={onHide}>
          <X size={16}/>
        </button>
      </header>
      {removing && <div className="area-delete-confirm" role="alertdialog" aria-label="确认删除区域">
        <span>确认删除“{item.name || '区域'}”？</span>
        <button aria-label="确认删除区域" onClick={() => state.remove(item.id)}><Check size={14}/>删除</button>
        <button aria-label="取消删除区域" onClick={() => setRemoving(false)}>取消</button>
      </div>}
      <div className="area-editor-content">
        <div className="area-editor-basics">
          <label className="area-color-field">颜色<input type="color" value={item.color} onChange={(e) => state.update(item.id, { color: e.target.value })}/></label>
          <label className="area-visible-field"><input type="checkbox" checked={item.visible} onChange={(e) => state.update(item.id, { visible: e.target.checked })}/>显示区域</label>
        </div>
        <div className="area-editor-actions">
          <button onClick={onHide}>收起编辑</button>
          <button disabled={!state.canUndo} onClick={state.undoMove}>撤销移动</button>
        </div>
        <details className="area-metrics">
          <summary title="闭合边界点可长按拖动，双指取消">球面面积估算 · 周长约 {Math.round(metrics.perimeter).toLocaleString('zh-CN')} m</summary>
          <p>闭合边界点可长按拖动，双指取消。</p>
        </details>
        {(state.error || notice) && <p role="status" className="area-status">{state.error || notice}</p>}
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
      </div>
    </section>
  );
}
