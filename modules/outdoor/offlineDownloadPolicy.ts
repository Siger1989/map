/** TianDiTu offline downloads are paused to protect the account quota. */
export const TIANDITU_OFFLINE_DISABLED = '天地图离线下载已暂停，以保护服务额度；已有天地图离线包仍可查看或删除';

type DownloadableTrip = {
  provider?: string;
  urls?: string[];
} | null | undefined;

function isTiandituResource(value: string) {
  if (/^tdt:/i.test(value)) return true;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return ['tianditu.gov.cn', 'tianditu.com'].some(
      (domain) => host === domain || host.endsWith(`.${domain}`),
    );
  } catch {
    return false;
  }
}

/** False for TianDiTu packages, including legacy packages without provider metadata. */
export function canDownloadTrip(trip: DownloadableTrip) {
  return !trip || (trip.provider !== 'tianditu' && !(trip.urls ?? []).some(isTiandituResource));
}
