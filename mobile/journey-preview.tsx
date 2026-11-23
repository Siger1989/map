import { useState } from 'react';
import {createRoot} from 'react-dom/client';
import {AppearanceProvider} from '../modules/appearance/AppearanceProvider';
import {JourneyViewer} from '../modules/sky/JourneyViewer';
import {JourneyWeather} from '../modules/journey/JourneyWeather';
import {createJourneyPlayback, type SkyJourney} from '../modules/sky/journeyPlayback';
import windingRoad from './preview-data/qingcheng-winding-road.json';
import { findWeatherDemo } from './preview-data/weather-demos';
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
const query = new URLSearchParams(location.search);
const showWeather = query.has('weather');
const demo = findWeatherDemo(query.get('weather-demo'));
const sample = query.get('route');
const points: [number, number][] = demo?.points ?? (sample==='winding'
  ? windingRoad.coordinates.map(([longitude,latitude])=>[longitude,latitude]) : sample==='road' ? road : mountain);
const tomorrowInChina = new Date(Date.now() + 32 * 3600000).toISOString().slice(0, 10);
const start = demo ? Math.ceil(Date.now() / 60_000) * 60_000 : showWeather
  ? Date.parse(tomorrowInChina + 'T11:00+08:00') : Date.UTC(2026, 10, 20, 2);
const durationHours = demo ? 2 : showWeather ? 3 : 1;
const journey: SkyJourney = {
  name: demo ? `${demo.name} · © OpenStreetMap 贡献者` : sample==='winding' ? '青城山盘山路 · © OpenStreetMap 贡献者' : sample==='road' ? '青城山 · 公路示例' : '青城山 · 示例轨迹',
  segments: [points.map((coordinates, index) => ({
    coordinates,
    timeMs: start + durationHours * 3600000 * index / (points.length - 1),
  }))],
};
const weatherModel = showWeather ? createJourneyPlayback(journey) : null;
function JourneyPreview() {
  const [weather, setWeather] = useState(showWeather);
  return weather && weatherModel
    ? <JourneyWeather name={journey.name} model={weatherModel} initialDuration={durationHours * 3600} onBack={() => setWeather(false)} />
    : <JourneyViewer journey={journey} onClose={() => window.location.assign('/')} />;
}

createRoot(document.getElementById('root')!).render(<AppearanceProvider><JourneyPreview /></AppearanceProvider>);
