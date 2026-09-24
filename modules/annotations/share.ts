import type { RoutePlace } from '../navigation/types.ts';
import { markerIcon } from './icons.ts';
import type { Annotation } from './data.ts';

export type AnnotationSharePlace = RoutePlace & {
  shareText: string;
  shareSummary: string;
};

/** Formats a saved pin for the existing system text-share flow. Photos stay local. */
export function annotationSharePlace(item: Annotation): AnnotationSharePlace {
  const name = item.name.trim() || '地点标记';
  const [lng, lat] = item.coordinates;
  const lines = [
    name,
    '山兔地点标记',
    `经度、纬度：${lng.toFixed(6)}, ${lat.toFixed(6)}（WGS84）`,
    `海拔：${item.groundElevation === null ? '—' : `${Number(item.groundElevation.toFixed(1))} m`}`,
    `图案：${markerIcon(item.icon).name}`,
    `颜色：${item.color.toUpperCase()}`,
    `显示：${item.visible ? '是' : '否'}`,
  ];
  if (item.borehole)
    lines.push(`钻孔深度：${item.borehole.depth === null ? '—' : `${item.borehole.depth} m`}`);
  if (item.note.trim()) lines.push(`备注：${item.note}`);
  if (item.attributes?.length) {
    lines.push('自定义条目：');
    item.attributes.forEach(({ name: field, value }) =>
      lines.push(`- ${field.trim() || '未命名'}：${value}`),
    );
  }
  lines.push('照片附件不会进入系统文本分享。');
  return {
    name,
    coordinates: [...item.coordinates],
    shareText: lines.join('\n'),
    shareSummary: '完整点信息（照片附件不随文本分享）',
  };
}
