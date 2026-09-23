/** Recognition only: never treat a private binary document as XML. */
export function identifyRouteFile(bytes: Uint8Array, name: string): 'zip' | 'text' | 'fit' | 'ovobj' {
  const head = String.fromCharCode(...bytes.subarray(0, 12));
  if (head.startsWith('OviO') || /\.ovobj$/i.test(name)) return 'ovobj';
  if (!bytes.length) throw new Error('路线文件为空');
  if (head.slice(8, 12) === '.FIT' || /\.fit$/i.test(name))
    return 'fit';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 3 && bytes[3] === 4) return 'zip';
  if (/\.(kmz|ovkmz|zip)$/i.test(name)) throw new Error('压缩包内容无效，请重新导出 KMZ / OVKMZ');
  if (/\.(shp|shx|dbf|gpkg|dxf|dwg|plt)$/i.test(name))
    throw new Error('当前尚未支持此格式；请从原软件导出 GPX / KML，奥维请导出 OVKML');
  return 'text';
}

export function decodeRouteText(bytes: Uint8Array, delimited = false): string {
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
    : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
  let text: string;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
  catch { throw new Error('文件不是有效的 UTF-8 / UTF-16 文本，请从原软件重新导出 GPX / KML'); }
  if (!text.trim()) throw new Error('路线文件为空');
  if ((!delimited && !/^\s*(?:<|\{|\[)/.test(text)) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))
    throw new Error('未识别的路线格式，当前支持 GPX / KML / KMZ / OVKML / OVKMZ 和山兔 JSON 备份');
  return text;
}
