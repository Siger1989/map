import { useMemo, useState, type ComponentProps } from 'react';
import { RouteCollectionsPanel } from './RouteCollectionsPanel';
import {
  catalogEntries,
  CATALOG_TYPES,
  groupCatalog,
  regionFor,
  type CatalogEntry,
} from './catalog';
import { useRegions } from './useRegions';
import { coordinateKey } from './regions';
import { collectionTransfer, collectionSpreadsheet } from './export';
import { deliverFile } from '../files/delivery';
import { XLSX_MIME } from '../files/spreadsheet';
import { markerIcon } from '../annotations/icons';
import type { Annotation } from '../annotations/data';
import type { SectionObject } from '../section/sectionObjects';
import type { MapArea } from '../areas/data';
import './collections.css';
type Props = ComponentProps<typeof RouteCollectionsPanel> & {
  annotations: Annotation[];
  sections: SectionObject[];
  areas: MapArea[];
  onArea: (id: string) => void;
  onAnnotation: (id: string) => void;
  onSection: (id: string) => void;
};
export function CollectionsPanel(props: Props) {
  const entries = useMemo(
    () =>
      catalogEntries(
        props.favorites.items,
        props.tracks.saved,
        props.annotations,
        props.sections,
        props.areas,
      ),
    [
      props.favorites.items,
      props.tracks.saved,
      props.annotations,
      props.sections,
      props.areas,
    ],
  );
  const regions = useRegions(entries);
  const [legacy, setLegacy] = useState(false),
    [type, setType] = useState<keyof typeof CATALOG_TYPES>('all'),
    [search, setSearch] = useState('');
  const [batch, setBatch] = useState(false),
    [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState<string | null>(null);
  const [province, setProvince] = useState(''),
    [city, setCity] = useState(''),
    [country, setCountry] = useState('');
  const [output, setOutput] = useState(false),
    [format, setFormat] = useState<'json' | 'xlsx'>('json'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const shown = entries.filter((e) => {
    const r = regionFor(e, regions.regions);
    return (
      (type === 'all' || type === e.kind) &&
      `${e.name} ${e.detail} ${r?.country ?? ''} ${r?.province ?? ''} ${r?.city ?? ''}`
        .toLowerCase()
        .includes(search.trim().toLowerCase())
    );
  });
  const groups = groupCatalog(shown, regions.regions),
    item = entries.find((e) => e.key === editing);
  const chosen = entries.filter((e) => selected.includes(e.key));
  const toggle = (key: string) =>
    setSelected((a) =>
      a.includes(key) ? a.filter((k) => k !== key) : [...a, key],
    );
  const open = (e: CatalogEntry) => {
    if (e.kind === 'route') props.onRoute(e.route);
    else if (e.kind === 'track') props.onTrack(e.track.id);
    else if (e.kind === 'section') props.onSection(e.section.id);
    else if (e.kind === 'area') props.onArea(e.area.id);
    else props.onAnnotation(e.annotation.id);
  };
  const edit = (e: CatalogEntry) => {
    const r = regionFor(e, regions.regions);
    setProvince(r?.province ?? '');
    setCity(r?.city ?? '');
    setCountry(r?.country ?? '');
    setEditing(e.key);
    setMessage('');
  };
  const share = async (send: boolean) => {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const content =
        format === 'json'
          ? JSON.stringify(
              collectionTransfer(chosen, regions.regions, localStorage),
              null,
              2,
            )
          : new Uint8Array(
              collectionSpreadsheet(chosen, regions.regions, localStorage),
            );
      setMessage(
        await deliverFile(
          new File([content], `Shantu-collection-${Date.now()}.${format}`, {
            type: format === 'json' ? 'application/json' : XLSX_MIME,
          }),
          send,
        ),
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '导出失败，请重试');
    } finally {
      setBusy(false);
    }
  };
  if (legacy)
    return (
      <section className="catalog-legacy">
        <button className="collection-back" onClick={() => setLegacy(false)}>
          ‹ 全部收藏 · 省市分类
        </button>
        <RouteCollectionsPanel {...props} />
      </section>
    );
  return (
    <section className="collections-panel catalog-panel" aria-label="全部收藏">
      {output ? (
        <div className="collection-editor collection-scroll">
          <button
            className="collection-back"
            disabled={busy}
            onClick={() => setOutput(false)}
          >
            ‹ 返回批量选择
          </button>
          <strong>分享 {chosen.length} 个条目</strong>
          <label>
            文件格式
            <select
              value={format}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option value="json">山兔数据 · JSON（可重新载入）</option>
              <option value="xlsx">Excel 表格 · XLSX</option>
            </select>
          </label>
          <p className="collection-hint">
            JSON 保留完整路线、标记属性、剖面与测点；Excel
            按工作表列出数据与坐标。
          </p>
          <div className="collection-actions">
            <button
              disabled={busy || !chosen.length}
              onClick={() => void share(false)}
            >
              {busy ? '生成中…' : '保存文件'}
            </button>
            <button
              disabled={busy || !chosen.length}
              onClick={() => void share(true)}
            >
              系统分享
            </button>
          </div>
        </div>
      ) : item ? (
        <div className="collection-editor collection-scroll">
          <button className="collection-back" onClick={() => setEditing(null)}>
            ‹ 返回收藏
          </button>
          <strong>{item.name}</strong>
          <div className="collection-actions">
            <button onClick={() => open(item)}>定位 / 编辑</button>
            <button
              onClick={() => {
                setSelected([item.key]);
                setOutput(true);
              }}
            >
              分享条目
            </button>
          </div>
          {(item.kind === 'route' || item.kind === 'track') && (
            <div className="collection-actions">
              <button
                onClick={() =>
                  item.kind === 'route'
                    ? props.onNavigateRoute(item.route)
                    : props.onNavigateTrack(item.track.id)
                }
              >
                开始导航
              </button>
              <button
                onClick={() =>
                  item.kind === 'route'
                    ? props.onShareRoute(item.route)
                    : props.onShareTrack(item.track.id)
                }
              >
                路线图 / GPX / 导航链接
              </button>
            </div>
          )}
          <div className="catalog-region-inputs">
            <label>
              省 / 州
              <input
                aria-label="收藏省份"
                value={province}
                maxLength={80}
                onChange={(e) => setProvince(e.target.value)}
              />
            </label>
            <label>
              城市
              <input
                aria-label="收藏城市"
                value={city}
                maxLength={80}
                onChange={(e) => setCity(e.target.value)}
              />
            </label>
          </div>
          <label>
            国家 / 地区
            <input
              aria-label="收藏国家"
              value={country}
              maxLength={80}
              onChange={(e) => setCountry(e.target.value)}
            />
          </label>
          <button
            onClick={() => {
              if (
                regions.save(item.key, {
                  country: country.trim(),
                  province: province.trim(),
                  city: city.trim(),
                  coordinateKey: coordinateKey(item.coordinates),
                  source: 'manual',
                  checkedAt: Date.now(),
                })
              ) {
                setMessage('地区已保存');
                setEditing(null);
              }
            }}
          >
            保存地区分类
          </button>
          <p className="collection-hint">
            {item.kind === 'route' || item.kind === 'track'
              ? '跨省市路线按起点归类。'
              : ''}
            自动地区：Photon / OpenStreetMap；可手动修正。
          </p>
        </div>
      ) : (
        <>
          <div className="catalog-search">
            <input
              aria-label="搜索收藏"
              placeholder="搜索名称 / 省 / 市"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <button
              aria-pressed={batch}
              onClick={() => {
                setBatch(!batch);
                setSelected([]);
              }}
            >
              {batch ? '取消' : '多选'}
            </button>
            <button aria-label="路线自定义分组" onClick={() => setLegacy(true)}>
              分组
            </button>
          </div>
          <nav className="collection-tabs catalog-types" aria-label="收藏类型">
            {Object.entries(CATALOG_TYPES).map(([key, label]) => (
              <button
                key={key}
                aria-pressed={type === key}
                onClick={() => setType(key as typeof type)}
              >
                {label}
                <small>
                  {key === 'all'
                    ? entries.length
                    : entries.filter((e) => e.kind === key).length}
                </small>
              </button>
            ))}
          </nav>
          {batch && (
            <div className="collection-actions catalog-batch">
              <button
                onClick={() =>
                  setSelected((a) =>
                    shown.every((e) => a.includes(e.key))
                      ? a.filter((k) => !shown.some((e) => e.key === k))
                      : [...new Set([...a, ...shown.map((e) => e.key)])],
                  )
                }
              >
                全选当前 {shown.length}
              </button>
              <button disabled={!chosen.length} onClick={() => setOutput(true)}>
                分享 / 导出 {chosen.length}
              </button>
            </div>
          )}
          <div
            className="collection-scroll catalog-list"
            aria-label="省市收藏列表"
          >
            {!shown.length && (
              <p className="collection-empty">
                {entries.length
                  ? '没有匹配的收藏'
                  : '地图标记、模型、保存的剖面与路线都会出现在这里'}
              </p>
            )}
            {groups.map((g) => (
              <details key={g.key} className="catalog-province" open>
                <summary>
                  {g.name}
                  <small>
                    {g.cities.reduce((n, [, list]) => n + list.length, 0)}
                  </small>
                </summary>
                {g.cities.map(([city, list]) => (
                  <details key={city} className="catalog-city" open>
                    <summary>
                      {city}
                      <small>{list.length}</small>
                    </summary>
                    {list.map((e) => (
                      <div className="catalog-row" key={e.key}>
                        {batch && (
                          <label className="catalog-check">
                            <input
                              type="checkbox"
                              aria-label={`选择 ${e.name}`}
                              checked={selected.includes(e.key)}
                              onChange={() => toggle(e.key)}
                            />
                          </label>
                        )}
                        <button
                          className="collection-open"
                          onClick={() => (batch ? toggle(e.key) : open(e))}
                        >
                          {'annotation' in e && (
                            <svg
                              viewBox="0 0 24 24"
                              width="21"
                              height="21"
                              aria-hidden="true"
                            >
                              <path d={markerIcon(e.annotation.icon).path} />
                            </svg>
                          )}
                          <span>
                            <strong>{e.name}</strong>
                            <small>
                              {CATALOG_TYPES[e.kind]} · {e.detail}
                            </small>
                          </span>
                        </button>
                        <button
                          className="catalog-more"
                          aria-label={`整理 ${e.name}`}
                          onClick={() => edit(e)}
                        >
                          •••
                        </button>
                      </div>
                    ))}
                  </details>
                ))}
              </details>
            ))}
          </div>
          <div className="catalog-source">
            <span>
              {regions.loading ? '正在识别省市…' : '省 → 市 · 路线按起点归类'}
            </span>
            <button disabled={regions.loading} onClick={regions.retry}>
              重试地区
            </button>
          </div>
        </>
      )}
      {(message || regions.message || props.navigationError) && (
        <p className="collection-status" role="status">
          {message || props.navigationError || regions.message}
        </p>
      )}
    </section>
  );
}
