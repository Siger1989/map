export async function deliverRouteFile(file: File, share: boolean) {
  if (window.GuanyunNative) {
    if (!window.GuanyunNative.routeOutput)
      throw new Error('此 APK 不支持路线分享，请安装新版');
    const encoded = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('文件读取失败'));
      r.readAsDataURL(file);
    });
    const result = window.GuanyunNative.routeOutput(file.name, encoded, share);
    if (result !== 'ok') throw new Error(result || '无法打开系统选择器');
    return '已请求打开系统选择器';
  }
  if (share) {
    if (!navigator.canShare?.({ files: [file] }))
      throw new Error('此浏览器不支持文件分享，请保存后分享');
    await navigator.share({ files: [file], title: '山兔路线' });
    return '已交给系统分享';
  }
  const url = URL.createObjectURL(file),
    a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return '已下载路线文件';
}
