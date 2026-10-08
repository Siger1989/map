export function saveFile(name: string, mime: string, text: string) {
  if (window.GuanyunNative) {
    if (text.length > 8 * 1024 * 1024)
      throw new Error('旧版几何文件超过 8 MB，请使用“一键导出完整 JSON”');
    window.GuanyunNative.saveFile(name, mime, text);
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
