import { placeShareData, type PlaceShareSource } from './data.ts';
import { macShareText } from '../platform/macNative.ts';

export async function sharePlace(place: PlaceShareSource) {
  const data = placeShareData(place);
  if (window.ShantuMac?.version === 1) {
    const result = await macShareText(data.text);
    if (result === 'cancelled') throw new DOMException('分享已取消', 'AbortError');
    if (result !== 'shared') throw new Error('macOS 未确认分享完成');
    return '已完成系统分享';
  }
  if (window.GuanyunNative) {
    if (!window.GuanyunNative.placeTextShare) throw new Error('请安装新版 APK，或复制地点信息后分享');
    const result = window.GuanyunNative.placeTextShare(data.text);
    if (result !== 'ok') throw new Error(result || '无法打开系统分享');
    return '已请求打开系统分享';
  }
  if (!navigator.share) throw new Error('此浏览器不支持系统分享，请复制地点信息');
  await navigator.share({ title: data.name, text: data.text });
  return '已交给系统分享';
}
