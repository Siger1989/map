export function RouteProviderNote() {
  return (
    <details className="route-provider-note">
      <summary>使用说明与数据来源</summary>
      <p className="route-note">
        输入地名后选结果，或在地图选点。最多8个途经点，拖动右侧柄调整顺序后重新规划。仅离线模式使用已下载步行路网；离线搜索仅含该路网道路名。
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
        <a href="https://photon.komoot.io/" target="_blank" rel="noreferrer">
          Photon 搜索
        </a>{' '}
        · © OpenStreetMap。路网无实时路况，通行条件需现场判断。
      </p>
    </details>
  );
}
