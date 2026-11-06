import { placeNavigationData, placeShareData, type PlaceShareSource } from './data.ts';
import { macShareText, writeClipboard } from '../platform/macNative.ts';

export async function copyAndOpenPlaceNavigation(place: PlaceShareSource) {
  const data = placeNavigationData(place);
  await writeClipboard(data.text);
  const bridge = typeof window === 'undefined' ? undefined :
    (window as unknown as { GuanyunNative?: { openAmapMarker?: (url: string) => string } }).GuanyunNative;
  if (typeof bridge?.openAmapMarker === 'function') {
    const result = bridge.openAmapMarker(data.url);
    if (result === 'requested') return '导航信息已复制，已请求高德地图打开此地点';
    if (result === 'unavailable') return '导航信息已复制；未检测到高德地图，请在高德地图中粘贴链接';
    return `导航信息已复制；高德地图未能打开${result ? `：${result}` : ''}`;
  }
  if (typeof window !== 'undefined') {
    const opened = window.open(data.url, '_blank', 'noopener,noreferrer');
    return opened
      ? '导航信息已复制，已尝试打开地点链接；若未跳转，请在高德地图中粘贴链接'
      : '导航信息已复制；浏览器未允许打开链接，请在高德地图中粘贴链接';
  }
  return '导航信息已复制；请在高德地图中粘贴链接';
}

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
