import {createRoot} from 'react-dom/client';
import {AppearanceProvider} from '../modules/appearance/AppearanceProvider';
import {JourneyViewer} from '../modules/sky/JourneyViewer';
import type {SkyJourney} from '../modules/sky/journeyPlayback';
import '../app/globals.css';

// Preview-only examples. The road follows the visible satellite imagery near Qingcheng Mountain.
const mountain: [number, number][] = [
  [103.5690,30.9040],[103.56851,30.90415],[103.56804,30.90442],[103.56758,30.90476],
  [103.56719,30.90512],[103.56671,30.90541],[103.56628,30.90553],
];
const road: [number, number][] = [
  [103.594980,30.901626],[103.594798,30.901433],[103.594637,30.901221],[103.594444,30.900954],
  [103.594272,30.900697],[103.594090,30.900411],[103.593929,30.900163],[103.593779,30.899905],
  [103.593639,30.899656],[103.593553,30.899509],[103.593467,30.899398],[103.593371,30.899306],
  [103.593253,30.899251],[103.593071,30.899205],[103.592738,30.899122],[103.592384,30.899039],
  [103.591944,30.898938],[103.591429,30.898828],[103.591118,30.898782],[103.590753,30.898736],
  [103.590227,30.898653],[103.589766,30.898579],[103.589251,30.898505],[103.588768,30.898432],
  [103.588414,30.898386],
];
const isRoad = new URLSearchParams(location.search).get('route') === 'road';
const points = isRoad ? road : mountain;
const start = Date.UTC(2026, 10, 20, 2);
const journey: SkyJourney = {
  name: isRoad ? '青城山 · 公路示例' : '青城山 · 示例轨迹',
  segments: [points.map((coordinates, index) => ({
    coordinates,
    timeMs: start + 3600000 * index / (points.length - 1),
  }))],
};
createRoot(document.getElementById('root')!).render(<AppearanceProvider><JourneyViewer journey={journey} onClose={()=>window.location.assign('/')}/></AppearanceProvider>);
