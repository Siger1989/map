import { INITIAL_GEOLOGY, type GeologyState } from './data';

/**
 * Global surface geology legend/details. The optional legacy callbacks remain
 * accepted so older page call sites compile, but this panel cannot select or
 * request the retired detailed Cloud service.
 */
export function GeologyPanel({
  state: snapshot,
}: {
  state: GeologyState;
  source?: GeologyState['source'];
  onSource?: (source: GeologyState['source']) => void;
  onRetry?: () => void;
}) {
  const state = snapshot.source === 'world'
    ? snapshot
    : { ...INITIAL_GEOLOGY, status: 'loading' as const };
  const selected = state.selection;
  const status: Record<GeologyState['status'], string> = {
    off: '地质图已关闭',
    loading: '正在加载全球地质图…',
    ready: '点击地图查看地质单元',
    empty: '当前视野没有可用地质单元，请缩小或移动地图',
    error: '全球地质数据暂时无法连接，网络恢复后请刷新页面',
    authorization: '全球地质图服务状态异常',
  };

  return (
    <aside className="geology-panel geology-card glass" aria-label="全球地质颜色与岩性参考">
      <div className="geology-heading">
        <strong>地质图例</strong>
        <span>全球地质 · 世界概览</span>
      </div>
      {state.legend.length > 0 && (
        <div>
          <div className="geology-legend">
            {state.legend.map((unit) => (
              <div key={unit.key}>
                <i style={{ background: unit.color }} />
                <span title={`岩性：${unit.lithology}`}>
                  {unit.name}
                  <small>{unit.age} · {unit.lithology}</small>
                </span>
              </div>
            ))}
          </div>
          <div className="geology-line-legend">
            <span><i />断层（原图）</span>
            <span><i />其他构造线</span>
          </div>
        </div>
      )}
      <p>颜色对应原图地层／岩性，与海拔无关。</p>
      <p className="geology-status" role="status">{state.message || status[state.status]}</p>
      {selected && (
        <div className="geology-selection">
          <strong><i style={{ background: selected.color }} />{selected.name}</strong>
          <dl>
            <dt>年代</dt><dd>{selected.age}</dd>
            <dt>岩性</dt><dd>{selected.lithology}</dd>
          </dl>
          {selected.description && <p>{selected.description}</p>}
          <small>图源：{selected.source}</small>
        </div>
      )}
      <p className="geology-scale-note">放大不增加原图精度 · 非地下剖面</p>
      <details className="geology-sources">
        <summary>数据来源与许可</summary>
        <p><a href="https://tiles.macrostrat.org/" target="_blank" rel="noreferrer">Macrostrat · CC BY 4.0</a></p>
        {state.sources.map((source) => (
          <p key={source.name}>
            {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.name}</a> : source.name}
          </p>
        ))}
      </details>
    </aside>
  );
}
