import { defaultPlaceSearchSource } from './provider';

export function RouteProviderNote() {
  return (
    <details className="route-provider-note">
      <summary>使用说明与数据来源</summary>
      <p className="route-note">
        自动模式下，驾车、骑行和步行优先联网；网络连接失败或超时后尝试对应离线路网。离线汽车和摩托车须事先下载各自覆盖起终点的路网，基础机动车离线规划仅支持起终点。摩托车不会改用汽车或自行车方案。无网地名搜索仅含已下载道路名；虚线接入仅为步行示意，不代表机动车可通行。
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
