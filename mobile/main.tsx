import { createRoot } from 'react-dom/client';
import { AppearanceProvider } from '../modules/appearance/AppearanceProvider';
import { installLayoutCompatibility } from './compatibility';
import Home from '../app/page';
import { LayoutCustomization } from '../modules/uiLayout/LayoutCustomization';
import { installNativeUIRegions } from './native-ui-regions';
import { findWeatherDemo } from './preview-data/weather-demos';
import type { CameraSnapshot } from '../modules/controls/useMapFocusLock';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../modules/photos/photos.css';
import '../app/globals.css';
import '../modules/controls/workspace.css';
import '../modules/controls/panels.css';
import '../modules/geology/legend.css';
import '../modules/navigation/navigation.css';
import '../modules/tracks/tracks.css';
import '../modules/journey/journey.css';
import '../modules/journey/route-rail.css';
import '../modules/position/position.css';
import '../modules/annotations/annotations.css';
import '../modules/section/section.css';
import '../modules/objectTransform/objectTransform.css';
import '../modules/controls/modern.css';
import './compatibility.css';
import '../modules/controls/compactDensity.css';
import '../modules/controls/homeMap.css';
import '../modules/controls/outdoorSurfaces.css';
import '../modules/controls/outdoorTheme.css';
import '../modules/appearance/roundedSpring.css';
import '../modules/controls/focusLockMotion.css';

// The APK owns its local HTTPS asset origin. No RSC server or development URL.
installLayoutCompatibility();
installNativeUIRegions();
const demoId = location.origin === 'http://127.0.0.1:9174' ? new URLSearchParams(location.search).get('weather-demo') : null;
const demo = findWeatherDemo(demoId);
const weatherPreview: CameraSnapshot | undefined = demo && {
  center: demoId === 'snow' ? [128.50, 42.075] : demo.center,
  zoom: 10, pitch: 0, bearing: 0,
};
createRoot(document.getElementById('root')!).render(
  <AppearanceProvider>
    <Home weatherPreview={weatherPreview} />
    <LayoutCustomization />
  </AppearanceProvider>,
);
