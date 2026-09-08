import type { ArchiveEntry } from '../files/archive';
import { archiveName } from '../files/archive.ts';
import { spreadsheetBytes } from '../files/spreadsheet.ts';
import type { TripPhoto } from '../photos/storage';
import { photosForTrack } from '../photos/trackPhotos.ts';
import { routeFileText, type ShareRoute } from './data.ts';

/** Image generation is provided by the caller; package assembly stays testable offline. */
export function routeArchiveEntries(
  data: ShareRoute,
  allPhotos: TripPhoto[],
  image: Blob,
): ArchiveEntry[] {
  const photos = photosForTrack(data.track, allPhotos);
  const metadata = photos.map((p, i) => {
    const { preview, detail, ...info } = p;
    // UI object URLs are ephemeral and must never become exported data.
    const { url: _url, ...plain } = info as typeof info & { url?: string };
    return {
      ...plain,
      file: `照片/${String(i + 1).padStart(3, '0')}-${archiveName(p.title || p.name.replace(/\.[^.]+$/, ''))}.jpg`,
      quality: detail ? '清晰副本（最长边2560px）' : '旧版预览副本',
      captureTime: new Date(p.time).toISOString(),
    };
  });
  const track = data.track ?? {
    id: 'shared-route',
    name: data.name,
    segments: data.segments,
    navigationMode: data.mode,
    createdAt: Date.now(),
  };
  return [
    { path: '路线图-含二维码.jpg', data: image },
    { path: '完整路线.gpx', data: routeFileText(data, 'gpx') },
    { path: '完整路线.kml', data: routeFileText(data, 'kml') },
    {
      path: '山兔路线.json',
      data: JSON.stringify(
        {
          format: 'guanyun-backup',
          version: 1,
          tracks: [track],
          favorites: [],
          annotations: [],
        },
        null,
        2,
      ),
    },
    {
      path: '照片清单.json',
      data: JSON.stringify(
        {
          routeName: data.name,
          trackId: track.id,
          coordinates: 'WGS84',
          photos: metadata,
        },
        null,
        2,
      ),
    },
    {
      path: '照片清单.xlsx',
      data: spreadsheetBytes([
        {
          name: '照片',
          rows: [
            [
              '文件',
              '名称',
              '拍摄时间（UTC）',
              '经度（WGS84）',
              '纬度（WGS84）',
              '海拔（米）',
              '位置来源',
              '备注',
              '图片质量',
            ],
            ...metadata.map((p) => [
              p.file,
              p.title || p.name,
              p.captureTime,
              ...p.coordinates,
              p.altitude?.metres ?? null,
              p.kind === 'point' ? '轨迹点位置' : '轨迹时间估算',
              p.note || '',
              p.quality,
            ]),
          ],
        },
      ]),
    },
    ...photos.map((p, i) => ({
      path: metadata[i].file,
      data: p.detail ?? p.preview,
    })),
    {
      path: '说明.txt',
      data: `山兔路线包：${data.name}\n包含完整路线 GPX/KML、可重新导入的山兔路线 JSON、带离线二维码的全程路线图及 ${photos.length} 张关联照片。\n二维码容量不足时概括线形；GPX/KML/JSON 不简化线形。GPX和JSON另保留原始分段、时间与已有海拔；KML仅交换点线。\n照片是本应用现存的清晰副本，最长边2560px；旧数据可能只有预览，逐张质量见清单。手机原片不在本应用存储中。照片按拍摄时间排序；名称、坐标、海拔、备注、旋转和绘制标注保存在照片清单JSON中，JPEG为导入的副本。\n位置为WGS84。路线图的海拔曲线是地形模型采样。解压后可在山兔导入路线JSON或GPX/KML，照片文件另行选择导入；二维码本身不包含照片。\n`,
    },
  ];
}
