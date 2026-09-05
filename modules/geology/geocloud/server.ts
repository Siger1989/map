import { parseCapabilities, type WmtsMetadata } from './capabilities';
import { tileInMatrix } from './projection';

export const GEOCLOUD_GATEWAY = 'https://geocloud.cgs.gov.cn/igss/igs/rest/ogc/';
// Historical 1:200,000 service identifier. A valid token AND a matching
// GetCapabilities response are required before this can be displayed as 200k.
const DEFAULT_SERVICE = 'qg20_20210401_FCnDDRJd';
class ProviderError extends Error { constructor(message: string, public status = 502) { super(message); } }
let cached: { key: string; until: number; data: WmtsMetadata } | undefined;
function configuration() {
  const token = process.env.GEOCLOUD_TOKEN?.trim();
  if (!token) throw new ProviderError('1∶20 万服务尚未配置授权 Token，请先完成地质云服务授权。', 503);
  const service = process.env.GEOCLOUD_SERVICE?.trim() || DEFAULT_SERVICE;
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(service)) throw new ProviderError('地质云服务标识配置无效', 503);
  return { token, service, layer: process.env.GEOCLOUD_LAYER?.trim() || '' };
}
async function upstream(params: Record<string, string>) {
  const config = configuration();
  const url = new URL(`${GEOCLOUD_GATEWAY}${config.service}/WMTSServer`);
  Object.entries({ SERVICE: 'WMTS', VERSION: '1.0.0', ...params, tk: config.token }).forEach(([key, val]) => url.searchParams.set(key, val));
  // Never forward caller headers or follow a redirect carrying the provider key.
  const reply = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (reply.status === 401 || reply.status === 403) throw new ProviderError('地质云授权无效或无权访问该服务，请更新 Token。', 401);
  if (!reply.ok) throw new ProviderError('地质云服务暂时不可用，请核对获授权的服务标识。');
  if (Number(reply.headers.get('content-length')) > 4 * 1024 * 1024) throw new ProviderError('地质云响应过大');
  const body = new Uint8Array(await reply.arrayBuffer());
  if (body.length > 4 * 1024 * 1024) throw new ProviderError('地质云响应过大');
  const prefix = new TextDecoder().decode(body.subarray(0, 1024));
  if (/Token失效|token.{0,30}(invalid|expired)|请重新登录|未授权|没有权限/i.test(prefix)) throw new ProviderError('地质云授权无效或已过期，请更新 Token。', 401);
  return body;
}
async function metadata() {
  const config = configuration(), key = JSON.stringify(config);
  if (cached?.key === key && cached.until > Date.now()) return cached.data;
  const bytes = await upstream({ REQUEST: 'GetCapabilities' });
  let data: WmtsMetadata;
  try { data = parseCapabilities(new TextDecoder().decode(bytes), config.layer); }
  catch (error) { throw new ProviderError(error instanceof Error ? error.message : '地图元数据无效'); }
  cached = { key, until: Date.now() + 5 * 60_000, data };
  return data;
}
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function imageType(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) return 'image/png';
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
}
export async function geocloudResponse(request: Request): Promise<Response> {
  try {
    const params = new URL(request.url).searchParams;
    const action = params.get('request');
    if (!['capabilities', 'tile', 'legend'].includes(action || '')) return Response.json({ message: '无效地质图请求' }, { status: 400, headers });
    const data = await metadata();
    if (action === 'capabilities') {
      const { legendUrl, ...publicData } = data;
      const json = JSON.stringify({ ...publicData, hasLegend: Boolean(legendUrl) }).replaceAll(configuration().token, '[redacted]');
      return new Response(json, { headers: { ...headers, 'Content-Type': 'application/json' } });
    }
    let body: Uint8Array;
    if (action === 'legend') {
      if (!data.legendUrl) return new Response(null, { status: 404, headers });
      const url = new URL(data.legendUrl, GEOCLOUD_GATEWAY);
      if (url.protocol !== 'https:' || !['geocloud.cgs.gov.cn', 'igss.cgs.gov.cn'].includes(url.hostname) || url.username || url.password
        || !['', '443', '6160'].includes(url.port)) throw new ProviderError('服务图例地址暂不支持代理');
      url.searchParams.set('tk', configuration().token);
      const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      if (!response.ok) throw new ProviderError('原图图例暂时无法加载');
      body = new Uint8Array(await response.arrayBuffer());
      if (body.length > 4 * 1024 * 1024) throw new ProviderError('图例尺寸过大');
    } else {
      const matrix = data.matrices.find((item) => item.id === params.get('matrix'));
      const colText = params.get('col') || '', rowText = params.get('row') || '';
      const col = Number(colText), row = Number(rowText);
      if (!matrix || !/^\d+$/.test(colText) || !/^\d+$/.test(rowText) || !tileInMatrix(matrix, col, row)) return Response.json({ message: '瓦片超出服务范围' }, { status: 400, headers });
      body = await upstream({ REQUEST: 'GetTile', LAYER: data.layer, STYLE: data.style, FORMAT: data.format,
        TILEMATRIXSET: data.matrixSet, TILEMATRIX: matrix.id, TILECOL: String(col), TILEROW: String(row) });
    }
    const type = imageType(body);
    if (!type) throw new ProviderError('地质云未返回图像，请核对服务权限与覆盖范围');
    return new Response(body.buffer as ArrayBuffer, { headers: { ...headers, 'Content-Type': type } });
  } catch (error) {
    // Do not return raw fetch errors, provider URLs or secret-bearing responses.
    const message = error instanceof ProviderError ? error.message : '地质云连接超时或失败，请稍后重试';
    return Response.json({ message }, { status: error instanceof ProviderError ? error.status : 502, headers });
  }
}
