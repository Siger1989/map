import coordtransform from 'coordtransform';
import type { Coordinate } from '../navigation/types';
export type ImportCoordinates = 'auto' | 'cgcs2000' | 'gcj02';
export function importCoordinate(
  point: Coordinate,
  system: ImportCoordinates,
): Coordinate {
  if (system === 'auto')
    throw new Error(
      '奥维文件无法仅凭扩展名判断坐标系；请按导出设置选择CGCS2000或GCJ02后重新导入',
    );
  return system === 'gcj02'
    ? coordtransform.gcj02towgs84(point[0], point[1])
    : [...point];
}
