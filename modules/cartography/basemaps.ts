/** The public browser application key is supplied locally; never commit a real key. */
export function basemapConfiguration(
  key = process.env.NEXT_PUBLIC_TIANDITU_KEY ?? '',
) {
  const token = key.trim();
  return { domestic: /^[a-zA-Z0-9]{16,128}$/.test(token), token };
}
export function tiandituTiles(
  layer: 'img' | 'vec' | 'cia' | 'cva',
  token: string,
) {
  return [0, 1, 2, 3].map(
    (host) =>
      `https://t${host}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${encodeURIComponent(token)}`,
  );
}
export const TIANDITU_CREDIT =
  '<a href="https://www.tianditu.gov.cn/" target="_blank">天地图 · 国家地理信息公共服务平台</a>';
