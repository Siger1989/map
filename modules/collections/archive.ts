import { archiveBlob, archiveName, type ArchiveEntry } from '../files/archive';
import { exportGPX, exportKML } from '../outdoor/exchange';
import { routeArchiveEntries } from '../routeShare/archive';
import { shareTrack, sharePlanned } from '../routeShare/data';
import { renderRouteImage } from '../routeShare/image';
import type { TripPhoto } from '../photos/storage';
import type { CatalogEntry } from './catalog';
import type { CollectionRegions } from './regions';
import { collectionSpreadsheet, collectionTransfer } from './export';
import { ANNOTATION_STORAGE, parseAnnotations } from '../annotations/data';

export async function collectionArchive(
  entries: CatalogEntry[],
  regions: CollectionRegions,
  storage: Pick<Storage, 'getItem'>,
  photos: TripPhoto[],
  signal?: AbortSignal,
  progress?: (message: string) => void,
) {
  const transfer = collectionTransfer(entries, regions, storage);
  const files: ArchiveEntry[] = [
    { path: '山兔收藏.json', data: JSON.stringify(transfer, null, 2) },
    {
      path: '收藏数据.xlsx',
      data: collectionSpreadsheet(entries, regions, storage),
    },
    { path: '地理对象.gpx', data: exportGPX(transfer) },
    { path: '地理对象.kml', data: exportKML(transfer) },
    {
      path: '说明.txt',
      data: '山兔收藏压缩包\n山兔收藏.json保留全部勾选对象的模型参数、自定义属性、路线、区域和剖面，可解压后在山兔重新导入。Excel提供分表坐标与属性。GPX/KML提供其支持的线路及点位；三维模型完整形状和变换参数以JSON为准。每条路线的子目录另含二维码全程图和关联照片。\n仅导出已勾选条目。\n',
    },
  ];
  for (let i = 0; i < entries.length; i++) {
    signal?.throwIfAborted();
    const e = entries[i];
    if (e.kind !== 'route' && e.kind !== 'track') continue;
    progress?.(`正在生成路线图 ${i + 1}/${entries.length} · ${e.name}`);
    const data =
      e.kind === 'track'
        ? shareTrack(
            e.track,
            parseAnnotations(storage.getItem(ANNOTATION_STORAGE)),
          )
        : sharePlanned(e.route.route, e.name);
    const image = await renderRouteImage(
      data,
      signal ?? new AbortController().signal,
    );
    const folder = `${String(i + 1).padStart(3, '0')}-${archiveName(e.name)}`;
    files.push(
      ...routeArchiveEntries(data, photos, image).map((file) => ({
        ...file,
        path: `${folder}/${file.path}`,
      })),
    );
  }
  progress?.('正在打包文件与照片…');
  return archiveBlob(files, signal);
}
