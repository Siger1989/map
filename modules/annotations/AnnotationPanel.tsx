import { useEffect, useState } from 'react';
import type { Coordinate } from '../navigation/types';
import {
  altitudeRange,
  dimensionLabel,
  KINDS,
  volume,
  type Annotation,
  type AnnotationKind,
} from './data';
import type { AnnotationsState } from './useAnnotations';

function NumberField({
  label,
  value,
  onValue,
  min,
  max,
  step = 0.1,
}: {
  label: string;
  value: number | null;
  onValue: (value: number) => void;
  min: number;
  max: number;
  step?: number;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);
  return (
    <label className="annotation-field">
      <span>{label}</span>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        placeholder={value === null ? '未取得' : undefined}
        onChange={(event) => setText(event.target.value)}
        onBlur={(event) => {
          const next = Number(text);
          if (
            text.trim() &&
            Number.isFinite(next) &&
            next >= min &&
            next <= max
          ) {
            event.target.setCustomValidity('');
            onValue(next);
          } else {
            event.target.setCustomValidity(
              `请输入 ${min} 到 ${max} 之间的数值`,
            );
            event.target.reportValidity();
          }
        }}
        onInput={(event) => event.currentTarget.setCustomValidity('')}
      />
    </label>
  );
}
function Editor({
  item,
  state,
  onLocate,
  onPick,
}: {
  item: Annotation;
  state: AnnotationsState;
  onLocate: (coordinate: Coordinate) => void;
  onPick: (kind: AnnotationKind | 'move') => void;
}) {
  const change = (patch: Partial<Annotation>) => state.update(item.id, patch);
  const [removing, setRemoving] = useState(false);
  const range = altitudeRange(item),
    size = volume(item);
  return (
    <div className="annotation-editor">
      <label className="annotation-field">
        <span>名称</span>
        <input
          value={item.name}
          maxLength={60}
          onChange={(event) => change({ name: event.target.value })}
        />
      </label>
      <div className="annotation-grid">
        <label className="annotation-field">
          <span>颜色</span>
          <input
            type="color"
            value={item.color}
            onChange={(event) => change({ color: event.target.value })}
          />
        </label>
        <label className="annotation-field">
          <span>所在位置</span>
          <select
            value={item.placement}
            onChange={(event) =>
              change({
                placement: event.target.value as Annotation['placement'],
                opacity: event.target.value === 'underground' ? 0.3 : 0.55,
              })
            }
          >
            <option value="surface">地表外</option>
            <option value="underground">地表内</option>
          </select>
        </label>
      </div>
      <div className="annotation-actions">
        <button onClick={() => onPick('move')}>地图重选位置</button>
        <button onClick={() => onLocate(item.coordinates)}>
          地图上长按调整
        </button>
        <button
          disabled={state.moveUndoId !== item.id}
          onClick={state.undoMove}
        >
          撤销移动
        </button>
      </div>
      <p className="annotation-note">
        点击地图上的标记名称或模型可查看和编辑。长按模型本体或名称约半秒，再拖动位置，坐标同步更新，松手自动保存；双指或
        Esc 取消。
      </p>
      {item.kind !== 'pin' && (
        <>
          <div className="annotation-grid">
            <NumberField
              label={item.kind === 'box' ? '宽度（米）' : '直径（米）'}
              value={item.width}
              min={0.1}
              max={10000}
              onValue={(width) => change({ width })}
            />
            {item.kind === 'box' && (
              <NumberField
                label="长度（米）"
                value={item.length}
                min={0.1}
                max={10000}
                onValue={(length) => change({ length })}
              />
            )}
            {item.kind !== 'sphere' && (
              <NumberField
                label="高度（米）"
                value={item.height}
                min={0.1}
                max={10000}
                onValue={(height) => change({ height })}
              />
            )}
            <NumberField
              label={
                item.placement === 'underground'
                  ? '顶部埋深（米）'
                  : '底部离地（米）'
              }
              value={item.offset}
              min={0}
              max={10000}
              onValue={(offset) => change({ offset })}
            />
          </div>
          <details className="annotation-details">
            <summary>角度与透明度</summary>
            <div className="annotation-grid">
              <NumberField
                label="朝向（°，北为0）"
                value={item.heading}
                min={-360}
                max={360}
                step={1}
                onValue={(heading) => change({ heading })}
              />
              <NumberField
                label="俯仰（°）"
                value={item.pitch}
                min={-360}
                max={360}
                step={1}
                onValue={(pitch) => change({ pitch })}
              />
              <NumberField
                label="侧倾（°）"
                value={item.roll}
                min={-360}
                max={360}
                step={1}
                onValue={(roll) => change({ roll })}
              />
              <NumberField
                label="不透明度"
                value={item.opacity}
                min={0.1}
                max={0.85}
                step={0.05}
                onValue={(opacity) => change({ opacity })}
              />
            </div>
          </details>
          <div className="annotation-metrics">
            <strong>{dimensionLabel(item)}</strong>
            <span>
              体积约{' '}
              {size?.toLocaleString('zh-CN', { maximumFractionDigits: 2 })} m³
            </span>
            <span>
              {range
                ? `底 / 顶海拔 ${range.bottom.toFixed(1)} / ${range.top.toFixed(1)} m`
                : '地面海拔未取得，模型暂不显示'}
            </span>
          </div>
          <p className="annotation-note">
            尺寸按真实米制等比例显示；
            {item.placement === 'underground'
              ? '埋深从模型最高点到锚点地面计算，地下以半透明透视显示。'
              : '离地距离从模型最低点到锚点地面计算。'}
            地面起伏以锚点为参考。
          </p>
        </>
      )}
      <details className="annotation-details">
        <summary>坐标与地面海拔</summary>
        <div className="annotation-grid">
          <NumberField
            label="经度"
            value={item.coordinates[0]}
            min={-180}
            max={180}
            step={0.000001}
            onValue={(lng) => {
              if (lng !== item.coordinates[0])
                state.move(item.id, [lng, item.coordinates[1]]);
            }}
          />
          <NumberField
            label="纬度"
            value={item.coordinates[1]}
            min={-85}
            max={85}
            step={0.000001}
            onValue={(lat) => {
              if (lat !== item.coordinates[1])
                state.move(item.id, [item.coordinates[0], lat]);
            }}
          />
        </div>
        <NumberField
          label="地面海拔（米）"
          value={item.groundElevation}
          min={-12000}
          max={10000}
          onValue={(value) => state.manualElevation(item.id, value)}
        />
        <button
          disabled={state.reading}
          onClick={() => void state.refreshElevation(item.id, item.coordinates)}
        >
          {state.reading ? '正在读取地形…' : '重新读取地形海拔'}
        </button>
      </details>
      <label className="annotation-field">
        <span>备注 / 参数说明</span>
        <textarea
          value={item.note}
          rows={2}
          maxLength={500}
          onChange={(event) => change({ note: event.target.value })}
          placeholder="例如洞口、坑道用途、尺寸来源"
        />
      </label>
      <div className="annotation-actions">
        <button onClick={() => state.duplicate(item.id)}>复制用于对比</button>
        <button
          onClick={() => {
            if (removing) state.remove(item.id);
            else setRemoving(true);
          }}
        >
          {removing ? '确认删除此标记' : '删除'}
        </button>
        {removing && <button onClick={() => setRemoving(false)}>取消</button>}
      </div>
    </div>
  );
}
export function AnnotationPanel({
  state,
  onPick,
  onLocate,
}: {
  state: AnnotationsState;
  onPick: (kind: AnnotationKind | 'move') => void;
  onLocate: (coordinate: Coordinate) => void;
}) {
  const selected = state.items.find((a) => a.id === state.selected);
  const [exportText, setExportText] = useState('');
  const exportData = () => {
    const text = JSON.stringify(
      {
        format: 'guanyun.annotations.v1',
        units: 'metres',
        coordinates: 'WGS84',
        annotations: state.items,
      },
      null,
      2,
    );
    setExportText(text);
    if (/Guanyun\//i.test(navigator.userAgent)) return;
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = '观云-标记模型参数.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <section className="annotation-panel" aria-label="标记与模型">
      <div className="annotation-add">
        {Object.entries(KINDS).map(([kind, label]) => (
          <button key={kind} onClick={() => onPick(kind as AnnotationKind)}>
            ＋{label}
          </button>
        ))}
      </div>
      <p className="annotation-note">
        选择类型后点地图放置。参数自动保存在本机；模型用于标注与对比，不代表实测地下结构。
      </p>
      {state.error && (
        <p className="annotation-error" role="status">
          {state.error}
        </p>
      )}
      {!!state.items.length && (
        <div className="annotation-list">
          {state.items.map((item) => (
            <div key={item.id}>
              <input
                type="checkbox"
                aria-label={`显示 ${item.name}`}
                checked={item.visible}
                onChange={(event) =>
                  state.update(item.id, { visible: event.target.checked })
                }
              />
              <button
                aria-pressed={selected?.id === item.id}
                onClick={() => state.select(item.id)}
              >
                <i style={{ background: item.color }} />
                <span>
                  {item.name || '未命名'}
                  <small>
                    {KINDS[item.kind]} ·{' '}
                    {item.placement === 'underground' ? '地下' : '地表'}
                  </small>
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
      {selected && (
        <Editor
          key={selected.id}
          item={selected}
          state={state}
          onPick={onPick}
          onLocate={onLocate}
        />
      )}
      {state.items.some((a) => a.kind !== 'pin') && (
        <details className="annotation-details">
          <summary>模型参数对比</summary>
          <div className="annotation-comparison">
            <table>
              <thead>
                <tr>
                  <th>模型</th>
                  <th>尺寸 / 体积</th>
                  <th>位置</th>
                </tr>
              </thead>
              <tbody>
                {state.items
                  .filter((a) => a.kind !== 'pin')
                  .map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>
                        {dimensionLabel(a)}
                        <br />
                        {volume(a)?.toLocaleString('zh-CN', {
                          maximumFractionDigits: 2,
                        })}{' '}
                        m³
                      </td>
                      <td>
                        {a.placement === 'underground'
                          ? `埋深 ${a.offset}`
                          : `离地 ${a.offset}`}{' '}
                        m
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {!!state.items.length && (
        <button className="annotation-export" onClick={exportData}>
          导出 / 复制模型参数
        </button>
      )}
      {exportText && (
        <label className="annotation-field">
          <span>参数副本（可长按选择复制）</span>
          <textarea
            readOnly
            rows={6}
            value={exportText}
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
    </section>
  );
}
