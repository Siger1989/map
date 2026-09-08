import QRCode from 'qrcode';
import type { ShareRoute } from './data';
import { makeRouteQr, qrAccuracy } from './qrCodec';
export async function routeQrImage(data: ShareRoute) {
  try {
    const encoded = makeRouteQr(data),
      canvas = document.createElement('canvas');
    await QRCode.toCanvas(canvas, encoded.text, {
      errorCorrectionLevel: 'M',
      width: 600,
      margin: 4,
      color: { dark: '#000000', light: '#ffffff' },
    });
    return { canvas, note: qrAccuracy(encoded.value) };
  } catch (e) {
    return {
      canvas: null,
      note: e instanceof Error ? e.message : '二维码生成失败，请分享路线文件',
    };
  }
}
