import { defaultPlaceSearchSource } from './provider';

export function RouteProviderNote() {
  return (
    <details className="route-provider-note">
      <summary>使用说明与数据来源</summary>
      <p className="route-note">
        默认优先联网规划；网络断开或请求超时后，自动尝试已下载的步行路网。请提前下载覆盖路线范围的路网。无网时的地名搜索仅包含已下载路网中的道路名。最多8个途经点，拖动右侧柄调整顺序后重新规划。
      </p>
      <p className="route-note">
        <a
          href="https://valhalla.openstreetmap.de/"
          target="_blank"
          rel="noreferrer"
        >
          在线 FOSSGIS / Valhalla
        </a>{' '}
        ·{' '}
        <a href={defaultPlaceSearchSource() === 'tianditu' ? 'https://lbs.tianditu.gov.cn/server/search2.html' : 'https://photon.komoot.io/'} target="_blank" rel="noreferrer">
          {defaultPlaceSearchSource() === 'tianditu' ? '天地图搜索 · 无结果时 Photon' : 'Photon 搜索'}
        </a>{' '}
        · © OpenStreetMap。路网无实时路况，通行条件需现场判断。
      </p>
    </details>
  );
}
