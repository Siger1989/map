import { INITIAL_GEOLOGY, type GeologyState } from './data';

export function GeologyPanel({
  state: snapshot,
  source,
  onSource,
  onRetry,
}: {
  state: GeologyState;
  source: GeologyState['source'];
  onSource: (source: GeologyState['source']) => void;
  onRetry: () => void;
}) {
  const state =
    snapshot.source === source
      ? snapshot
      : { ...INITIAL_GEOLOGY, source, status: 'loading' as const };
  const selected = state.selection;
  const cloud = source === 'geocloud20w';
  return (
    <aside
      className="geology-panel geology-card glass"
      aria-label="地质颜色与岩性参考"
    >
      <div className="geology-heading">
        <strong>地质图例</strong>
        <span>
          {cloud
            ? state.status === 'ready'
              ? '1∶20 万'
              : '1∶20 万 · 待连接'
            : '世界概览'}
        </span>
      </div>
      {!cloud && state.legend.length > 0 && (
        <div>
          <div className="geology-legend">
            {state.legend.map((unit) => (
              <div key={unit.key}>
                <i style={{ background: unit.color }} />
                <span title={`岩性：${unit.lithology}`}>
                  {unit.name}
                  <small>
                    {unit.age} · {unit.lithology}
                  </small>
                </span>
              </div>
            ))}
          </div>
          <div className="geology-line-legend">
            <span>
              <i />
              断层（原图）
            </span>
            <span>
              <i />
              其他构造线
            </span>
          </div>
        </div>
      )}
      <div
        className="geology-source-choice"
        role="group"
        aria-label="地质图来源"
      >
        <button aria-pressed={!cloud} onClick={() => onSource('world')}>
          世界概览
        </button>
        <button aria-pressed={cloud} onClick={() => onSource('geocloud20w')}>
          1∶20 万 · 地质云
        </button>
      </div>
      <p>颜色对应原图地层／岩性，与海拔无关。</p>
      <p className="geology-status" role="status">
        {state.message ||
          {
            off: '地质图已关闭',
            loading: '正在加载地质图…',
            ready: cloud
              ? '已连接原图服务，覆盖外区域可能无图'
              : '点击地图查看地质单元',
            empty: '当前视野没有可用地质单元，请缩小或移动地图',
            error: '地质数据暂时无法连接，网络恢复后请刷新页面',
            authorization: '1∶20 万服务需要地质云授权。',
          }[state.status]}
      </p>
      {cloud && (
        <div className="geology-cloud-info">
          {state.serviceTitle && <p>{state.serviceTitle}</p>}
          {state.status === 'authorization' && (
            <p>
              <a
                href="https://geocloud.cgs.gov.cn/"
                target="_blank"
                rel="noreferrer"
              >
                打开地质云获取服务授权 ↗
              </a>
            </p>
          )}
          {state.legendUrl ? (
            <img
              className="geology-provider-legend"
              src={state.legendUrl}
              alt="地质云服务提供的原图图例"
            />
          ) : (
            <p>连接后使用服务原图图例；未提供时不推测颜色含义。</p>
          )}
          <p>原图瓦片投射；暂不提供图斑岩性点选。</p>
          <button className="geology-retry" onClick={onRetry}>
            重新连接
          </button>
        </div>
      )}
      {!cloud && selected && (
        <div className="geology-selection">
          <strong>
            <i style={{ background: selected.color }} />
            {selected.name}
          </strong>
          <dl>
            <dt>年代</dt>
            <dd>{selected.age}</dd>
            <dt>岩性</dt>
            <dd>{selected.lithology}</dd>
          </dl>
          {selected.description && <p>{selected.description}</p>}
          <small>图源：{selected.source}</small>
        </div>
      )}
      <p className="geology-scale-note">放大不增加原图精度 · 非地下剖面</p>
      <details className="geology-sources">
        <summary>数据来源与许可</summary>
        {!cloud && (
          <p>
            <a
              href="https://tiles.macrostrat.org/"
              target="_blank"
              rel="noreferrer"
            >
              Macrostrat · CC BY 4.0
            </a>
          </p>
        )}
        {state.sources.map((source) => (
          <p key={source.name}>
            {source.url ? (
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.name}
              </a>
            ) : (
              source.name
            )}
          </p>
        ))}
      </details>
    </aside>
  );
}
