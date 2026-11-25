'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Circle, Download, RectangleHorizontal } from 'lucide-react';
import { deliverFile } from '../files/delivery';
import { MapPanelHeader } from '../ui/MapPanelHeader';
import { terrainPrintStl, type TerrainPrintGrid } from './mesh';
import './terrainPrint.css';

type PrintShape = 'rectangle' | 'circle';

export type TerrainPrintSelection = {
  bounds: { west: number; south: number; east: number; north: number };
  shape: PrintShape;
};

const SHAPES = [
  { value: 'rectangle', label: '矩形', icon: RectangleHorizontal, direction: '拖出矩形，或依次点击两个对角。' },
  { value: 'circle', label: '圆形', icon: Circle, direction: '从圆心拖到边缘，或依次点击圆心和边缘。' },
] as const;

type TerrainPrintResponse = TerrainPrintGrid & {
  error?: string;
  code?: string;
};

async function fetchTerrainPrintDem(selection: TerrainPrintSelection, token: string, signal: AbortSignal): Promise<TerrainPrintGrid> {
  const response = await fetch('/api/terrain-print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...selection, token: token || undefined }),
    signal,
  });
  const data = await response.json().catch(() => null) as TerrainPrintResponse | null;
  if (!response.ok || !data) {
    throw Object.assign(new Error(data?.error || '高程服务暂时无法完成，请稍后重试。'), { code: data?.code });
  }
  return data;
}

export function TerrainPrintPanel({
  selection,
  picking,
  onPick,
  onClose,
  onCancelPick,
  onExport,
  loadDem = fetchTerrainPrintDem,
}: {
  selection: TerrainPrintSelection | null;
  picking: boolean;
  onPick: (shape: PrintShape) => void;
  onClose: () => void;
  onCancelPick?: () => void;
  onExport?: (name: string, blob: Blob) => Promise<void> | void;
  loadDem?: (selection: TerrainPrintSelection, token: string, signal: AbortSignal) => Promise<TerrainPrintGrid>;
}) {
  const titleId = useId();
  const request = useRef<AbortController | null>(null);
  const [activeShape, setActiveShape] = useState<PrintShape>('rectangle');
  const [widthMm, setWidthMm] = useState('160');
  const [baseMm, setBaseMm] = useState('4');
  const [withRim, setWithRim] = useState(false);
  const [rimMm, setRimMm] = useState('4');
  const [token, setToken] = useState('');
  const [needsAuth, setNeedsAuth] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const shape = picking ? activeShape : selection?.shape;
  const baseFootprint = Number(widthMm) + 2 * Number(rimMm);

  useEffect(() => () => request.current?.abort(), []);

  function pick(next: PrintShape) {
    setActiveShape(next);
    setNotice('');
    setError('');
    onPick(next);
  }

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selection || picking || request.current) return;

    const modelWidth = Number(widthMm);
    const bottomThickness = Number(baseMm);
    const rimWidth = withRim ? Number(rimMm) : 0;
    if (modelWidth < 20 || modelWidth > 400 || bottomThickness < 1 || bottomThickness > 40 ||
      (withRim && (rimWidth < 1 || rimWidth > 40))) {
      setError('请检查模型宽度、底厚和包边宽度。');
      return;
    }

    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError('');
    setNotice('正在查找并下载选区的 8 米高程数据…');
    try {
      const data = await loadDem(selection, token.trim(), controller.signal);
      controller.signal.throwIfAborted();
      setNotice('正在生成封闭模型…');
      const stl = terrainPrintStl(data, {
        shape: selection.shape,
        widthMm: modelWidth,
        baseMm: bottomThickness,
        rimMm: rimWidth,
      });
      const name = `Shantu-terrain-${selection.shape}-${Date.now()}.stl`;
      const file = new File([stl], name, { type: 'model/stl' });
      if (onExport) {
        await onExport(name, file);
        setNotice('已发起 STL 保存。');
      } else {
        setNotice(await deliverFile(file, false, controller.signal));
      }
      setNeedsAuth(false);
      setToken('');
    } catch (failure) {
      if (!controller.signal.aborted) {
        const detail = failure && typeof failure === 'object' ? failure as { code?: unknown; message?: unknown } : null;
        if (detail?.code === 'AUTH_REQUIRED' || detail?.code === 'AUTH_INVALID') {
          setNeedsAuth(true);
          if (detail.code === 'AUTH_INVALID') setToken('');
        }
        setError(typeof detail?.message === 'string' && detail.message ? detail.message : '地形模型生成失败，请重试。');
      }
      if (request.current === controller) setNotice('');
    } finally {
      if (request.current === controller) {
        request.current = null;
        setPending(false);
      }
    }
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
          <p className="terrain-print-status">框选范围后，使用 8 米高程和 1 倍真实起伏。</p>
        ) : (
          <form className="terrain-print-form" onSubmit={generate}>
            <div className="terrain-print-dimensions">
              <label>
                <span>{selection.shape === 'circle' ? '山体直径' : '山体宽度'}（mm）</span>
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
                  <output>{selection.shape === 'circle' ? '底座外径' : '底座外宽'} {Number(baseFootprint.toFixed(1))} mm</output>
                )}
              </div>
            )}
            {needsAuth && (
              <div className="terrain-print-auth">
                <label>
                  <span>NASA Earthdata 访问令牌</span>
                  <input type="password" value={token} autoComplete="off" required disabled={pending}
                    onChange={(event) => setToken(event.target.value)} />
                </label>
                <a href="https://urs.earthdata.nasa.gov/profile" target="_blank" rel="noreferrer">从 Earthdata 账户获取令牌</a>
              </div>
            )}
            {error && <p className="terrain-print-error" role="alert">{error}</p>}
            {notice && <p className="terrain-print-status" role="status">{notice}</p>}
            {pending ? (
              <button type="button" className="terrain-print-action" onClick={() => request.current?.abort()}>
                取消生成
              </button>
            ) : (
              <button type="submit" className="terrain-print-action is-primary">
                <Download size={17} aria-hidden="true" />生成并导出 STL
              </button>
            )}
          </form>
        )}
      </div>
    </section>
  );
}
