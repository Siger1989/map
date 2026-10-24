import { planImportedRouteDownload } from './importedRouteDownload.ts';
import type { DownloadArea } from './downloadPlan.ts';
import type { MapSource } from '../mapSources/types.ts';

type Request = { id: number; area: Extract<DownloadArea, { kind: 'route' }>; source: MapSource; zoom: number; estimateOnly?: boolean };
self.addEventListener('message', (event: MessageEvent<Request>) => {
  const { id, area, source, zoom } = event.data;
  try {
    const plan = planImportedRouteDownload(area, source, zoom);
    self.postMessage({ id, plan: event.data.estimateOnly ? { count: plan.count, estimatedBytes: plan.estimatedBytes, bounds: plan.bounds } : plan });
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
});
