import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import 'maplibre-gl/dist/maplibre-gl.css';
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

// The APK owns its local HTTPS asset origin. No RSC server or development URL.
createRoot(document.getElementById('root')!).render(<Home />);
