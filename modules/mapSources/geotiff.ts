import { fromArrayBuffer } from 'geotiff';
import proj4 from 'proj4';
import { validBounds, type MapDraft } from './types.ts';

/** Bounded, north-up imagery. Resample in Mercator rather than stretching latitude. */
export async function decodeGeoTiff(bytes: ArrayBuffer, name: string) {
  const tiff = await fromArrayBuffer(bytes);
  try {
    const image = await tiff.getImage();
    const width = image.getWidth(),
      height = image.getHeight();
    if (image.getSamplesPerPixel() > 4)
      throw new Error('GeoTIFF 支持灰度 / RGB / RGBA，暂不支持多光谱影像');
    if (width * height > 16_000_000 || width < 2 || height < 2)
      throw new Error('GeoTIFF 支持最多 1600 万像素，请先降采样或转为 MBTiles');
    for (let i = 0; i < image.getSamplesPerPixel(); i++)
      if (image.getBitsPerSample(i) !== 8 || image.getSampleFormat(i) !== 1)
        throw new Error(
          'GeoTIFF 目前支持 8 位影像，不支持高程 DEM / 浮点或 16 位影像',
        );
    const keys = image.getGeoKeys();
    if (!keys || keys.GTRasterTypeGeoKey === 2)
      throw new Error(
        'GeoTIFF 缺少区域影像坐标参考，或使用暂不支持的 PixelIsPoint',
      );
    const epsg = Number(
      keys.ProjectedCSTypeGeoKey ?? keys.GeographicTypeGeoKey,
    );
    let crs = `EPSG:${epsg}`;
    if ((epsg >= 32601 && epsg <= 32660) || (epsg >= 32701 && epsg <= 32760)) {
      crs = `+proj=utm +zone=${epsg % 100} ${epsg >= 32700 ? '+south' : ''} +datum=WGS84 +units=m +no_defs`;
    } else if (![4326, 3857].includes(epsg))
      throw new Error(
        'GeoTIFF 支持 WGS84、Web Mercator 和 WGS84 UTM；此文件坐标系暂不支持',
      );
    const fd = image.getFileDirectory();
    const orientation = await fd.loadValue('Orientation');
    if (orientation !== undefined && orientation !== 1)
      throw new Error('GeoTIFF 像素方向须为左上原点，请先校正方向');
    const matrix = fd.getValue('ModelTransformation');
    if (matrix && (matrix[1] !== 0 || matrix[4] !== 0))
      throw new Error('暂不支持旋转的 GeoTIFF，请先在 GIS 中校正为北向上');
    const origin = image.getOrigin(),
      resolution = image.getResolution();
    if (resolution[0] <= 0 || resolution[1] >= 0)
      throw new Error('GeoTIFF 须为北向上的影像');
    const toMerc = proj4(crs, 'EPSG:3857'),
      toGeo = proj4('EPSG:3857', 'EPSG:4326');
    const extent = image.getBoundingBox();
    const perimeter: number[][] = [];
    for (let i = 0; i <= 32; i++) {
      const t = i / 32,
        x = extent[0] + (extent[2] - extent[0]) * t,
        y = extent[1] + (extent[3] - extent[1]) * t;
      perimeter.push(
        toMerc.forward([x, extent[1]]),
        toMerc.forward([x, extent[3]]),
        toMerc.forward([extent[0], y]),
        toMerc.forward([extent[2], y]),
      );
    }
    if (perimeter.some((p) => !p.every(Number.isFinite)))
      throw new Error('GeoTIFF 投影转换失败');
    const west = Math.min(...perimeter.map((p) => p[0])),
      east = Math.max(...perimeter.map((p) => p[0]));
    const south = Math.min(...perimeter.map((p) => p[1])),
      north = Math.max(...perimeter.map((p) => p[1]));
    const sw = toGeo.forward([west, south]),
      ne = toGeo.forward([east, north]);
    const bounds = validBounds([sw[0], sw[1], ne[0], ne[1]]);
    if (!bounds || east - west > 40075016 || north - south > 40075016)
      throw new Error('GeoTIFF 超出可显示范围或跨日期变更线，请拆分后导入');
    const scale = Math.min(1, 2048 / Math.max(width, height));
    const readWidth = Math.max(2, Math.round(width * scale)),
      readHeight = Math.max(2, Math.round(height * scale));
    const rgb = await image.readRGB({
      interleave: true,
      width: readWidth,
      height: readHeight,
      enableAlpha: true,
    });
    const channels = rgb.length / (readWidth * readHeight);
    if (![3, 4].includes(channels)) throw new Error('GeoTIFF 颜色通道暂不支持');
    const ratio = (east - west) / (north - south);
    const outWidth = Math.max(2, Math.round(ratio >= 1 ? 2048 : 2048 * ratio));
    const outHeight = Math.max(2, Math.round(ratio >= 1 ? 2048 / ratio : 2048));
    const pixels = new Uint8ClampedArray(outWidth * outHeight * 4);
    const nodata = image.getGDALNoData();
    for (let y = 0; y < outHeight; y++)
      for (let x = 0; x < outWidth; x++) {
        const point = toMerc.inverse([
          west + ((x + 0.5) / outWidth) * (east - west),
          north - ((y + 0.5) / outHeight) * (north - south),
        ]);
        const sx = Math.floor(
          ((point[0] - origin[0]) / resolution[0] / width) * readWidth,
        );
        const sy = Math.floor(
          ((point[1] - origin[1]) / resolution[1] / height) * readHeight,
        );
        if (sx < 0 || sy < 0 || sx >= readWidth || sy >= readHeight) continue;
        const i = (sy * readWidth + sx) * channels,
          o = (y * outWidth + x) * 4;
        pixels[o] = rgb[i];
        pixels[o + 1] = rgb[i + 1];
        pixels[o + 2] = rgb[i + 2];
        pixels[o + 3] =
          nodata !== null &&
          rgb[i] === nodata &&
          rgb[i + 1] === nodata &&
          rgb[i + 2] === nodata
            ? 0
            : channels === 4
              ? rgb[i + 3]
              : 255;
      }
    const draft: MapDraft = {
      kind: 'image',
      name,
      format: 'GeoTIFF',
      attribution: '用户导入的地理影像',
      bounds,
      minzoom: 0,
      maxzoom: 22,
      tileSize: 256,
      detail: `EPSG:${epsg} → Web Mercator · ${outWidth}×${outHeight} 像素离线副本`,
    };
    return { draft, pixels, width: outWidth, height: outHeight };
  } finally {
    await tiff.close();
  }
}
