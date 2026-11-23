import { createRoot } from 'react-dom/client';
import { AppearanceProvider } from '../modules/appearance/AppearanceProvider';
import snapshot from './preview-data/qingcheng-horizon.json';
import type { TerrainHorizon } from '../modules/sky/terrainHorizon';
import { SkyViewer } from '../modules/sky/SkyViewer';
import { usePosition } from '../modules/position/usePosition';
import '../app/globals.css';
import '../modules/controls/outdoorSurfaces.css';
import '../modules/controls/outdoorTheme.css';
import '../modules/appearance/roundedSpring.css';

function QingchengPreview() {
  const position = usePosition();
  return (
    <SkyViewer
      demo
      previewNight={new URLSearchParams(location.search).has('night')?Date.UTC(2026,6,18,14,30):undefined}
      previewTerrain={snapshot.terrain as TerrainHorizon}
      mapPoint={[snapshot.observer.lng, snapshot.observer.lat]}
      fix={position.fix}
      locate={() => position.locate()}
      onClose={() => window.location.assign('/')}
    />
  );
}
createRoot(document.getElementById('root')!).render(
  <AppearanceProvider>
    {new URLSearchParams(location.search).has('marker') ? (
      <SkyViewer demo markerName="青城山 · 示例标记" fix={null}
        mapPoint={[snapshot.observer.lng, snapshot.observer.lat]}
        previewTerrain={snapshot.terrain as TerrainHorizon}
        locate={() => {}} onClose={() => window.location.assign('/')} />
    ) : <QingchengPreview />}
  </AppearanceProvider>,
);
