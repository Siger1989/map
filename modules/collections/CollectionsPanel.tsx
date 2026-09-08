import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import { RouteCollectionsPanel } from './RouteCollectionsPanel';
import {
  catalogEntries,
  CATALOG_TYPES,
  groupCatalog,
  regionFor,
  type CatalogEntry,
} from './catalog';
import { removeEntries } from './remove';
import { useSwipeSelection } from './useSwipeSelection';
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
import { collectionArchive } from './archive';
import { ZIP_MIME } from '../files/archive';
import type { TripPhoto } from '../photos/storage';
type Props = ComponentProps<typeof RouteCollectionsPanel> & {
  annotations: Annotation[];
  sections: SectionObject[];
  areas: MapArea[];
  onArea: (id: string) => void;
  onAnnotation: (id: string) => void;
  onSection: (id: string) => void;
  initialOutputKey?: string | null;
  initialSelectedKeys?: string[];
  photos: TripPhoto[];
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
  const [batch, setBatch] = useState(!!props.initialSelectedKeys?.length),
    [selected, setSelected] = useState<string[]>(
      props.initialOutputKey
        ? [props.initialOutputKey]
        : (props.initialSelectedKeys ?? []),
    ),
    [editing, setEditing] = useState<string | null>(null);
  const [province, setProvince] = useState(''),
    [city, setCity] = useState(''),
    [country, setCountry] = useState('');
  const [output, setOutput] = useState(!!props.initialOutputKey),
    [format, setFormat] = useState<'zip' | 'json' | 'xlsx'>('zip'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
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
  const [deleting, setDeleting] = useState(false);
  const paint = (keys: string[], checked: boolean) =>
    setSelected((old) =>
      checked
        ? [...new Set([...old, ...keys])]
        : old.filter((k) => !keys.includes(k)),
    );
  const swipe = useSwipeSelection(paint);
  const groupSelect = (list: CatalogEntry[]) =>
    paint(
      list.map((e) => e.key),
      !list.every((e) => selected.includes(e.key)),
    );
  const deleteSelected = () => {
    try {
      removeEntries(chosen.map((e) => e.key));
      setSelected([]);
      setDeleting(false);
      setMessage(`已删除 ${chosen.length} 项`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '删除失败');
    }
  };
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
    const controller = new AbortController();
    abort.current = controller;
    try {
      const content =
        format === 'zip'
          ? await collectionArchive(
              chosen,
              regions.regions,
              localStorage,
              props.photos,
              controller.signal,
              setMessage,
            )
          : format === 'json'
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
            type:
              format === 'zip'
                ? ZIP_MIME
                : format === 'json'
                  ? 'application/json'
                  : XLSX_MIME,
          }),
          send,
          controller.signal,
        ),
      );
    } catch (e) {
      setMessage(
        e instanceof Error
          ? e.name === 'AbortError'
            ? '已取消，未输出不完整压缩包'
            : e.message
          : '导出失败，请重试',
      );
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
      {deleting ? (
        <div className="collection-editor collection-scroll">
          <strong>删除选中的 {chosen.length} 项？</strong>
          <p className="collection-hint">
            只删除已选条目及其分类记录。照片副本保留；未选中的行程标记保留为独立标记。此操作无法撤销。
          </p>
          <p className="collection-hint">
            {chosen
              .slice(0, 8)
              .map((e) => e.name)
              .join('、')}
            {chosen.length > 8 ? '…' : ''}
          </p>
          <div className="collection-actions">
            <button onClick={() => setDeleting(false)}>返回</button>
            <button className="catalog-danger" onClick={deleteSelected}>
              确认删除 {chosen.length} 项
            </button>
          </div>
        </div>
      ) : output ? (
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
              disabled={busy}
              onChange={(e) => setFormat(e.target.value as typeof format)}
            >
              <option value="zip">
                压缩包 · ZIP（路线图 / 照片 / 全部数据）
              </option>
              <option value="json">山兔数据 · JSON（可重新载入）</option>
              <option value="xlsx">Excel 表格 · XLSX</option>
            </select>
          </label>
          <p className="collection-hint">
            ZIP 包含勾选条目的 JSON、Excel
            和通用地理文件；路线另附二维码全程图、行程标记与关联照片。模型完整参数保存在
            JSON 中。
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
          {busy && (
            <button onClick={() => abort.current?.abort()}>取消生成</button>
          )}
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
              placeholder="名称 / 省 / 市"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              aria-label="收藏类型"
              value={type}
              onChange={(e) => setType(e.target.value as typeof type)}
            >
              {Object.entries(CATALOG_TYPES).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}{' '}
                  {key === 'all'
                    ? entries.length
                    : entries.filter((e) => e.kind === key).length}
                </option>
              ))}
            </select>
            <button
              aria-pressed={batch}
              onClick={() => {
                setBatch(!batch);
                setSelected([]);
              }}
            >
              {batch ? '完成' : '多选'}
            </button>
          </div>
          <div
            className="collection-scroll catalog-list"
            ref={swipe.list}
            aria-label="省市收藏列表"
          >
            {!shown.length && (
              <p className="collection-empty">
                {entries.length
                  ? '没有匹配的收藏'
                  : '地图标记、模型、剖面与路线保存在这里'}
              </p>
            )}
            {groups.map((g) =>
              g.cities.map(([city, list]) => (
                <section className="catalog-group" key={g.key + city}>
                  <div
                    className={`catalog-group-heading${batch ? ' is-batch' : ''}`}
                  >
                    <span title={`${g.name} / ${city}`}>
                      {g.name.split(' · ')[0]} / {city}{' '}
                      <small>{list.length}</small>
                    </span>
                    {batch && (
                      <>
                        <button
                          aria-label={`${g.name} 省分组全选`}
                          aria-pressed={g.cities
                            .flatMap(([, items]) => items)
                            .every((e) => selected.includes(e.key))}
                          onClick={() =>
                            groupSelect(g.cities.flatMap(([, items]) => items))
                          }
                        >
                          省选
                        </button>
                        <button
                          aria-label={`${city} 城市全选`}
                          aria-pressed={list.every((e) =>
                            selected.includes(e.key),
                          )}
                          onClick={() => groupSelect(list)}
                        >
                          市选
                        </button>
                      </>
                    )}
                  </div>
                  {list.map((e) => (
                    <div
                      className={`catalog-row${selected.includes(e.key) && batch ? ' is-selected' : ''}`}
                      key={e.key}
                    >
                      {batch && (
                        <button
                          className="catalog-check"
                          role="checkbox"
                          aria-label={`选择 ${e.name}`}
                          aria-checked={selected.includes(e.key)}
                          data-select-key={e.key}
                          onPointerDown={(event) =>
                            swipe.start(event, !selected.includes(e.key))
                          }
                          onClick={(event) => {
                            if (event.detail === 0) toggle(e.key);
                          }}
                        >
                          <span>{selected.includes(e.key) ? '✓' : ''}</span>
                        </button>
                      )}
                      <button
                        className="collection-open"
                        onClick={() => (batch ? toggle(e.key) : open(e))}
                      >
                        {'annotation' in e && (
                          <svg
                            viewBox="0 0 24 24"
                            width="18"
                            height="18"
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
                      {!batch && (
                        <button
                          className="catalog-more"
                          aria-label={`整理 ${e.name}`}
                          onClick={() => edit(e)}
                        >
                          •••
                        </button>
                      )}
                    </div>
                  ))}
                </section>
              )),
            )}
            <div className="catalog-source">
              <button disabled={regions.loading} onClick={regions.retry}>
                {regions.loading ? '识别地区…' : '重试地区'}
              </button>
              <button onClick={() => setLegacy(true)}>路线自定义分组</button>
            </div>
          </div>
          {batch && (
            <div className="collection-actions catalog-batch">
              <button
                aria-pressed={
                  !!shown.length && shown.every((e) => selected.includes(e.key))
                }
                onClick={() => groupSelect(shown)}
              >
                全选 {shown.length}
              </button>
              <button disabled={!chosen.length} onClick={() => setOutput(true)}>
                导出 {chosen.length}
              </button>
              <button
                className="catalog-danger"
                disabled={!chosen.length}
                onClick={() => setDeleting(true)}
              >
                删除
              </button>
            </div>
          )}
          {batch && (
            <small className="catalog-swipe-hint">
              沿左侧勾选栏滑动连选，靠近边缘自动滚动
            </small>
          )}
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
