import { Map } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  DrawingGestureBridge,
  type DrawingInput,
} from '../../modules/tracks/DrawingGestureBridge';

// Local-only regression fixture. The APK build has only mobile/index.html as input.
const map = new Map({
  container: 'map',
  center: [104, 30],
  zoom: 12,
  style: {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'background',
        type: 'background',
        paint: { 'background-color': '#d5e4db' },
      },
    ],
  },
  attributionControl: false,
});
const events: DrawingInput[] = [];
const bridge = new DrawingGestureBridge(map, (event) => events.push(event));
map.on('load', () => bridge.configure(true));
Object.assign(window, {
  gestureHarness: {
    map,
    state: () => ({
      ready: map.loaded(),
      zoom: map.getZoom(),
      events: [...events],
    }),
    reset: () => {
      bridge.configure(false);
      map.stop();
      map.jumpTo({ center: [104, 30], zoom: 12, bearing: 0, pitch: 0 });
      bridge.configure(true);
      events.length = 0;
    },
  },
});
