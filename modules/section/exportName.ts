import { EXPORT_PREFIX } from '../../config/product.ts';

/** Android image output accepts a bounded ASCII name, independent of the sheet title. */
export function sectionImageName(page: number, time = Date.now()): string {
  if (
    !Number.isInteger(page) ||
    page < 0 ||
    page >= 9999 ||
    !Number.isSafeInteger(time) ||
    time < 0
  )
    throw new Error('剖面导出页码或时间无效');
  return `${EXPORT_PREFIX}-section-${time}-${page + 1}.jpg`;
}
