export function saveFile(name: string, mime: string, text: string) {
  if (window.GuanyunNative) {
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
