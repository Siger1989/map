import './compatibility';
import { probeRuntime } from '../modules/compatibility/capabilities';

async function start() {
  const capabilities = probeRuntime(document, window);
  try {
    if (!capabilities.webgl2 || !capabilities.worker)
      throw new Error(
        !capabilities.webgl2
          ? '当前图形驱动未能创建三维地图画面'
          : '地图后台解码未能启动',
      );
    await import('./main');
  } catch (error) {
    // Keep failures actionable without demanding an OS/Google component update.
    const root = document.getElementById('root')!;
    root.textContent = '';
    root.style.cssText =
      'padding:24px;color:#eff6f7;background:#10212b;min-height:100vh;font:16px/1.6 sans-serif;box-sizing:border-box';
    const title = document.createElement('h2');
    title.textContent = '地图暂未启动';
    const message = document.createElement('p');
    message.textContent =
      '请先重试。若仍无法打开，可把下面的兼容信息发给开发者继续适配。';
    const retry = document.createElement('button');
    retry.textContent = '重新打开';
    retry.style.cssText = 'min-height:44px;padding:8px 20px';
    retry.onclick = () => location.reload();
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '兼容信息';
    summary.style.cssText = 'min-height:44px;margin-top:16px';
    const diagnostic = document.createElement('pre');
    diagnostic.style.cssText =
      'white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px';
    diagnostic.textContent = JSON.stringify(
      { app: '0.2.17-test', ...capabilities, error: String(error) },
      null,
      2,
    );
    details.appendChild(summary);
    details.appendChild(diagnostic);
    for (const child of [title, message, retry, details])
      root.appendChild(child);
  }
}
void start();
