import { useEffect, useRef, useState, type FormEvent } from 'react';
import { terrainPrintStl } from './mesh';
import { requestTerrainPrintDem } from './requestDem';
import { saveTerrainPrintModel, type TerrainPrintRecord } from './modelStore';

export function TerrainModelBaseEditor({ record, onApplied, onCancel }: {
  record: TerrainPrintRecord;
  onApplied: (record: TerrainPrintRecord) => void;
  onCancel: () => void;
}) {
  const [withRim, setWithRim] = useState(record.options.rimMm > 0);
  const [base, setBase] = useState(String(record.options.baseMm));
  const [rim, setRim] = useState(String(record.options.rimMm || 4));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  async function apply(event: FormEvent) {
    event.preventDefault();
    if (request.current) return;
    const baseMm = Number(base);
    const rimMm = withRim ? Number(rim) : 0;
    if (!Number.isFinite(baseMm) || baseMm < 1 || baseMm > 40 ||
        !Number.isFinite(rimMm) || rimMm < 0 || rimMm > 40 || (withRim && rimMm < 1)) {
      setError('请检查底厚和包边宽度。');
      return;
    }
    if (record.options.baseMm === baseMm && record.options.rimMm === rimMm) {
      onCancel();
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError('');
    try {
      const grid = record.grid ?? await requestTerrainPrintDem(record.selection, controller.signal);
      controller.signal.throwIfAborted();
      const options = { ...record.options, baseMm, rimMm };
      const next: TerrainPrintRecord = {
        ...record, grid, options, stl: terrainPrintStl(grid, options),
        elevationSource: record.grid ? record.elevationSource : 'built-in',
      };
      await saveTerrainPrintModel(next);
      if (!controller.signal.aborted) onApplied(next);
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : '无法更新底座。');
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setPending(false);
    }
  }

  return <form className="terrain-library-controls terrain-library-base" aria-label="底座设置" onSubmit={apply}>
    <div className="terrain-library-actions" role="group" aria-label="底座类型">
      <button type="button" aria-pressed={!withRim} onClick={() => setWithRim(false)} disabled={pending}>平底</button>
      <button type="button" aria-pressed={withRim} onClick={() => setWithRim(true)} disabled={pending}>外围包边</button>
    </div>
    <div className="terrain-library-actions">
      <label>底厚（mm）<input type="number" min={1} max={40} step={0.1} required
        value={base} disabled={pending} onChange={event => setBase(event.target.value)} /></label>
      {withRim && <label>每侧包边（mm）<input type="number" min={1} max={40} step={0.1} required
        value={rim} disabled={pending} onChange={event => setRim(event.target.value)} /></label>}
    </div>
    {!record.grid && <small>此收藏仅保存了模型。应用底座时将按原选区用地图自带 DEM 重新生成。</small>}
    {error && <p className="terrain-library-error" role="alert">{error}</p>}
    <button type="submit" className="is-primary terrain-library-export" disabled={pending}>
      {pending ? '正在更新底座…' : '应用底座'}
    </button>
  </form>;
}
