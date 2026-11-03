import { createSimulationGeoApi, makeSimFix, type SimFix } from '../modules/position/simulation';

export const simulationAllowed = import.meta.env.DEV && new URLSearchParams(location.search).get('sim') === '1' && location.port === '9286' && ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
const allowedOrigins = new Set([location.origin]);
type Command = { type: 'simulation:init'; fix: SimFix } | { type: 'simulation:fix'; fix: SimFix } | { type: 'simulation:lost' };
const geo = createSimulationGeoApi();
const send = (fix: SimFix) => { const value = makeSimFix(fix.longitude, fix.latitude, fix.speed, fix.heading, fix.accuracy, fix.timestamp); geo.publish({ coords: { longitude: value.longitude, latitude: value.latitude, accuracy: value.accuracy, altitude: null, altitudeAccuracy: null, heading: value.speed > 0 ? value.heading : null, speed: value.speed }, timestamp: value.timestamp }); };
if (!simulationAllowed) document.body.textContent = '模拟定位仅允许通过 localhost:9286/simulation-frame.html?sim=1 打开。';
else {
  Object.defineProperty(navigator, 'geolocation', { configurable: false, value: {
    watchPosition(success: PositionCallback, error?: PositionErrorCallback) { return geo.watchPosition(success as (p: any)=>void, error as ((e:any)=>void)); },
    getCurrentPosition(success: PositionCallback, error?: PositionErrorCallback) { geo.getCurrentPosition(success as (p: any)=>void, error as ((e:any)=>void)); },
    clearWatch(id: number) { geo.clearWatch(id); }
  } });
  window.addEventListener('message', event => { if (event.source !== parent || !allowedOrigins.has(event.origin)) return; const data = event.data as Command; if (!data || typeof data !== 'object') return; if ((data.type === 'simulation:init' || data.type === 'simulation:fix') && data.fix && Number.isFinite(data.fix.longitude) && Number.isFinite(data.fix.latitude) && Number.isFinite(data.fix.timestamp)) send(data.fix); else if (data.type === 'simulation:lost') geo.lose(); });
  parent.postMessage({ type: 'simulation:ready' }, location.origin);
}
