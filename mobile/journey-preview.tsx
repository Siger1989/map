import {createRoot} from 'react-dom/client';
import {AppearanceProvider} from '../modules/appearance/AppearanceProvider';
import {JourneyViewer} from '../modules/sky/JourneyViewer';
import type {SkyJourney} from '../modules/sky/journeyPlayback';
import '../app/globals.css';

// A short illustrative line independent of the user's saved routes.
const points: [number,number][]=[[103.5690,30.9040],[103.56851,30.90415],[103.56804,30.90442],[103.56758,30.90476],[103.56719,30.90512],[103.56671,30.90541],[103.56628,30.90553]];
const journey:SkyJourney={name:'青城山 · 示例轨迹',segments:[points.map(coordinates=>({coordinates}))]};
createRoot(document.getElementById('root')!).render(<AppearanceProvider><JourneyViewer journey={journey} onClose={()=>window.location.assign('/')}/></AppearanceProvider>);
