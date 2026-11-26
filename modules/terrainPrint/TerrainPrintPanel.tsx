'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Circle, Download, RectangleHorizontal } from 'lucide-react';
import { deliverFile } from '../files/delivery';
import { MapPanelHeader } from '../ui/MapPanelHeader';
import { terrainPrintStl } from './mesh';
import type { TerrainPrintRecord } from './modelStore';
import { requestTerrainPrintDem } from './requestDem';
import { selectionGroundSize, type PrintSelection } from './selection';
import './terrainPrint.css';

type PrintShape = PrintSelection['shape'];
export type TerrainPrintSelection = PrintSelection;

const SHAPES = [
  { value: 'rectangle', label: '矩形', icon: RectangleHorizontal, direction: '拖出矩形，或依次点击两个对角。' },
  { value: 'circle', label: '圆形', icon: Circle, direction: '从圆心拖到边缘，或依次点击圆心和边缘。' },
] as const;

export function TerrainPrintPanel({
  selection,
  picking,
  onPick,
  onClose,
  onCancelPick,
  onExport,
  onFavorite,
}: {
  selection: TerrainPrintSelection | null;
  picking: boolean;
  onPick: (shape: PrintShape) => void;
  onClose: () => void;
  onCancelPick?: () => void;
  onExport?: (name: string, blob: Blob) => Promise<void> | void;
  onFavorite?: (model: TerrainPrintRecord) => Promise<void>;
}) {
  const titleId = useId();
  const request = useRef<AbortController | null>(null);
  const [generated, setGenerated] = useState<TerrainPrintRecord | null>(null);
  const [savingFavorite, setSavingFavorite] = useState(false);
  const [activeShape, setActiveShape] = useState<PrintShape>('rectangle');
  const [widthMm, setWidthMm] = useState('160');
  const [baseMm, setBaseMm] = useState('4');
  const [withRim, setWithRim] = useState(false);
  const [rimMm, setRimMm] = useState('4');
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const shape = picking ? activeShape : selection?.shape;
  const baseFootprint = Number(widthMm) + 2 * Number(rimMm);
  const groundSize = selection ? selectionGroundSize(selection) : null;

  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    request.current?.abort();
    setGenerated(null);
    setNotice('');
    setError('');
  }, [selection]);

  function pick(next: PrintShape) {
    setActiveShape(next);
    setGenerated(null);
    setNotice('');
    setError('');
    onPick(next);
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || picking || request.current) return;

    const favoriteDirectly = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'favorite';
    const modelSize = Number(widthMm);
    const bottomThickness = Number(baseMm);
    const rimWidth = withRim ? Number(rimMm) : 0;
    if (modelSize < 20 || modelSize > 400 || bottomThickness < 1 || bottomThickness > 40 ||
      (withRim && (rimWidth < 1 || rimWidth > 40))) {
      setError('请检查模型宽度、底厚和包边宽度。');
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setGenerated(null);
    setError('');
    setNotice('正在读取地图自带高程…');
    try {
      const data = await requestTerrainPrintDem(selection, controller.signal);
      controller.signal.throwIfAborted();
      const modelWidth = selection.shape === 'circle' ? modelSize :
        modelSize * (data.eastWestMeters / Math.max(data.eastWestMeters, data.northSouthMeters));
      const resolution = data.sampleSpacingMeters
        ? `网格间距约 ${formatDistance(data.sampleSpacingMeters)}，真实起伏 1 倍。`
        : '真实起伏 1 倍。';
      setNotice(`正在生成封闭模型。${resolution}`);
      const stl = terrainPrintStl(data, {
        shape: selection.shape,
        widthMm: modelWidth,
        baseMm: bottomThickness,
        rimMm: rimWidth,
      });
      const name = `Shantu-terrain-${selection.shape}-${Date.now()}.stl`;
      const file = new File([stl], name, { type: 'model/stl' });
      if (onFavorite) {
        const createdAt = Date.now();
        const suffix = new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(createdAt);
        const model: TerrainPrintRecord = {
          id: crypto.randomUUID(),
          name: (selection.shape === 'circle' ? '圆形地形 ' : '矩形地形 ') + suffix,
          createdAt, selection, stl, grid: data, elevationSource: 'built-in',
          options: { shape: selection.shape, widthMm: modelWidth, baseMm: bottomThickness, rimMm: rimWidth },
        };
        if (favoriteDirectly) { await onFavorite(model); return; }
        setGenerated(model);
      }
      if (onExport) {
        await onExport(name, file);
        setNotice(`已发起 STL 保存。${resolution}`);
      } else {
        setNotice(`${await deliverFile(file, false, controller.signal)}。${resolution}`);
      }
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : '地形模型生成失败，请重试。');
      }
      if (request.current === controller) setNotice('');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
  }

  async function favorite() {
    if (!generated || !onFavorite || savingFavorite) return;
    setSavingFavorite(true);
    try { await onFavorite(generated); }
    catch { setError('无法保存模型到收藏，请检查设备存储空间。'); }
    finally { setSavingFavorite(false); }
  }

  return (
    <section
      className="terrain-print-panel control-popover glass"
      data-terrain-print-phase={picking ? 'picking' : 'settings'}
      data-app-back="42"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        if (picking && onCancelPick) onCancelPick();
        else onClose();
      }}
    >
      <MapPanelHeader title="地形打印" titleId={titleId} onClose={onClose} closeLabel="关闭地形打印" />
      <div className="terrain-print-content">
        <div className="terrain-print-shapes" role="group" aria-label="打印范围形状">
          {SHAPES.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => pick(value)}
              aria-pressed={shape === value}
              disabled={pending}
            >
              <Icon size={15} aria-hidden="true" />{label}框选
            </button>
          ))}
        </div>
        {picking ? (
          <div className="terrain-print-pick-help">
            <p className="terrain-print-status" role="status">
              {SHAPES.find(({ value }) => value === activeShape)?.direction}
            </p>
            {onCancelPick && <button type="button" onClick={onCancelPick}>取消框选</button>}
          </div>
        ) : !selection ? (
          <p className="terrain-print-status">使用地图自带 DEM，按 1 倍真实起伏生成模型。</p>
        ) : (
          <form className="terrain-print-form" onSubmit={generate}>
            {groundSize && <p className="terrain-print-status" aria-label="选区实际尺寸">
              {selection.shape === 'circle' ? `直径 ${formatDistance(Math.min(groundSize.width, groundSize.height))}` :
                `${formatDistance(groundSize.width)} × ${formatDistance(groundSize.height)}`} · 拖中心移动，拖控制点调整
            </p>}
            <div className="terrain-print-dimensions">
              <label>
                <span>{selection.shape === 'circle' ? '山体直径' : '模型长边'}（mm）</span>
                <input type="number" min="20" max="400" step="1" required value={widthMm} disabled={pending}
                  onChange={(event) => setWidthMm(event.target.value)} />
              </label>
              <label>
                <span>底厚（mm）</span>
                <input type="number" min="1" max="40" step="0.1" required value={baseMm} disabled={pending}
                  onChange={(event) => setBaseMm(event.target.value)} />
              </label>
            </div>
            <label className="terrain-print-rim-option">
              <input type="checkbox" checked={withRim} disabled={pending} onChange={(event) => setWithRim(event.target.checked)} />
              <span>外围包边底座</span>
            </label>
            {withRim && (
              <div className="terrain-print-rim">
                <label className="terrain-print-rim-width">
                  <span>每侧包边（mm）</span>
                  <input type="number" min="1" max="40" step="0.1" required value={rimMm} disabled={pending}
                    onChange={(event) => setRimMm(event.target.value)} />
                </label>
                {widthMm && rimMm && Number.isFinite(baseFootprint) && (
                  <output>{selection.shape === 'circle' ? '底座外径' : '底座长边'} {Number(baseFootprint.toFixed(1))} mm</output>
                )}
              </div>
            )}
            {error && <p className="terrain-print-error" role="alert">{error}</p>}
            {notice && <p className="terrain-print-status" role="status">{notice}</p>}
            {pending ? (
              <button type="button" className="terrain-print-action" onClick={() => request.current?.abort()}>
                取消生成
              </button>
            ) : (
              <div className="terrain-print-actions">
                <button type="submit" className="terrain-print-action is-primary">
                  <Download size={17} aria-hidden="true" />生成并导出 STL
                </button>
                {onFavorite && !generated && <button type="submit" value="favorite" className="terrain-print-action">
                  生成并收藏
                </button>}
              </div>
            )}
            {generated && !pending && <button type="button" className="terrain-print-action"
              onClick={() => void favorite()} disabled={savingFavorite}>
              {savingFavorite ? '正在保存…' : '保存到收藏'}
            </button>}
          </form>
        )}
      </div>
    </section>
  );
}

function formatDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} 米` : `${Number((meters / 1000).toFixed(2))} 公里`;
}
