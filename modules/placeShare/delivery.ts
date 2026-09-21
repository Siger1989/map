import type { RoutePlace } from '../navigation/types';
import { placeShareData } from './data.ts';

export async function sharePlace(place: RoutePlace) {
  const data = placeShareData(place);
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
