import { unzipSync, strFromU8 } from 'fflate';
import type { Transfer } from './types.ts';
import { validateTransfer } from './validation.ts';
import { parseXml } from './xmlImport.ts';
const MAX_BYTES = 8 * 1024 * 1024;
export async function parseFile(file: File): Promise<Transfer> {
  if (file.size > MAX_BYTES) throw new Error('文件超过 8 MB，请先拆分');
  let text: string;
  if (/\.kmz$/i.test(file.name)) {
    let size = 0,
      count = 0;
    const files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
      filter: (f) => {
        if (!/\.kml$/i.test(f.name)) return false;
        size += f.originalSize;
        count++;
        if (size > MAX_BYTES || count > 10)
          throw new Error('KMZ 内的 KML 超过大小限制');
        return true;
      },
    });
    const names = Object.keys(files);
    if (names.length !== 1) throw new Error('请选择只含一个 KML 文档的 KMZ');
    if (files[names[0]].length > MAX_BYTES)
      throw new Error('解压后的 KML 过大');
    text = strFromU8(files[names[0]]);
  } else text = await file.text();
  // Content takes precedence over a renamed extension. Coordinate conversion is separate.
  if (/^\s*\{/.test(text)) return validateTransfer(JSON.parse(text));
  if (/\.ovk(?:ml|mz)$/i.test(file.name))
    throw new Error(
      '奥维文件需要确认GCJ02或CGCS2000坐标系；请先从奥维按CGCS2000地理坐标导出并转为KML',
    );
  return parseXml(text, file.name);
}
