import { createRoot } from 'react-dom/client';
import { useMemo, useState, type CSSProperties } from 'react';
import { DEFAULT_APPEARANCE, themeTokens, type Palette } from '../modules/appearance/theme';
import { NavigationTelemetry } from '../modules/guidance/NavigationTelemetry';
import { GuidanceCard } from '../modules/guidance/GuidanceCard';
import { createSession } from '../modules/guidance/session';
import type { GuidanceState } from '../modules/guidance/useGuidance';
import { RallyElevation } from '../modules/rally/RallyElevation';
import { RouteElevationProfile } from '../modules/routeDisplay/RouteElevationProfile';
import { lineLength, type ElevationSample } from '../modules/journey/metrics';
import { routeElevationScale } from '../modules/routeAnalysis/elevationColors';
import type { PlannedRoute } from '../modules/navigation/types';
import type { ManualTrack } from '../modules/tracks/drawing';
import '../modules/appearance/appearance.css';
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
import '../modules/rally/rally.css';
import '../modules/routeDisplay/routeDisplay.css';

const query = new URLSearchParams(location.search);
const requestedWidth = Number(query.get('width'));
const width = requestedWidth === 360 ? 360 : 390;
const requestedTheme = query.get('theme');
const theme = requestedTheme === 'light' || requestedTheme === 'orange' ? requestedTheme : 'dark';
const orangePalette: Palette = { ...DEFAULT_APPEARANCE.dark, accent: '#ffad55', button: '#302b25' };
const palette = theme === 'light' ? DEFAULT_APPEARANCE.light : theme === 'orange' ? orangePalette : DEFAULT_APPEARANCE.dark;
const tokens = themeTokens(palette);
document.documentElement.dataset.uiTheme = theme === 'light' ? 'light' : 'dark';
Object.entries(tokens).forEach(([key, value]) => document.documentElement.style.setProperty(key, value));

const coordinates: [number, number][] = Array.from({ length: 25 }, (_, i) => [
  104.05 + i * 0.00045,
  30.65 + Math.sin(i / 3) * 0.00025,
]);
const route: PlannedRoute = {
  mode: 'bicycle', coordinates, distance: lineLength(coordinates), duration: 1900,
  steps: [{ instruction: '沿绿道继续前行', distance: 620, duration: 240, elapsedSeconds: 240, coordinates }],
  snapped: [coordinates[0], coordinates.at(-1)!],
  createdAt: 1760000000000,
};
const session = createSession(route, Date.now());
// Empty synthetic geometry short-circuits elevation loading and keeps this QA page offline-safe.
const rallyRoute: PlannedRoute = { ...route, coordinates: [] };
const guidance = {
  active: true, session, rejoin: null, loading: false, error: '', online: true,
  remaining: route.distance, instruction: { text: '沿绿道继续前行', distance: 620 },
  departureMessage: '', start: () => true, stop: () => undefined, retry: () => undefined,
  replan: async () => undefined, replanning: false,
} as GuidanceState;
const samples: ElevationSample[] = coordinates.map((point, i) => ({
  coordinates: point,
  distance: coordinates.slice(0, i + 1).length < 2 ? 0 : lineLength(coordinates.slice(0, i + 1)),
  part: 0,
  elevation: Math.round(310 + Math.sin(i / 3) * 28 + i * 1.7),
}));
const sampleTrack: Pick<ManualTrack, 'samples'> = {
  samples: [samples.map(({ elevation }) => ({ time: null, altitude: elevation }))],
};

function Fixture() {
  const [showRally, setShowRally] = useState(true);
  const syntheticScale = useMemo(() => routeElevationScale(sampleTrack), []);
  return (
    <>
      <style>{`
        html,body,#root{width:100%;height:100%;margin:0;background:#101716}
        #root{display:grid;place-items:center;overflow:auto}
        .qa-frame{position:relative;max-width:100vw;overflow:hidden;background:var(--ui-surface);color:var(--ui-ink);box-shadow:0 12px 48px #0008}
        .qa-frame .observatory{position:absolute;inset:0;overflow:hidden;background:linear-gradient(160deg,#314841 0%,#71806c 48%,#323e37 100%);--home-top:0px;--home-left:8px;--home-right:8px;--home-bottom:0px;--home-footer:64px;--home-header-height:60px}
        .qa-map{position:absolute;inset:0;opacity:.62;background:linear-gradient(24deg,transparent 48%,#d6ddb455 49%,#d6ddb455 50%,transparent 51%),linear-gradient(122deg,transparent 36%,#263d3555 37%,#263d3555 38%,transparent 39%)}
        .qa-map:after{content:"合成地图底图 · 仅供控件检查";position:absolute;top:48%;left:50%;transform:translate(-50%,-50%);color:#fff9;font-size:11px;white-space:nowrap}
        .qa-rally-toggle{position:absolute;z-index:12;bottom:calc(var(--home-footer) + 84px);right:8px;min-height:36px;padding:4px 8px;border:1px solid var(--ui-line);border-radius:var(--ui-radius-control);background:var(--ui-surface);color:var(--ui-ink);font-size:11px}
        .qa-profile{position:absolute;left:8px;right:8px;bottom:calc(var(--home-footer) + 80px);height:96px;padding:4px 8px;box-sizing:border-box;background:var(--ui-surface);color:var(--ui-ink);border:1px solid var(--ui-line);border-radius:var(--ui-radius-card);z-index:8}
        .qa-profile .route-elevation-profile{height:100%;padding:0;border:0;background:transparent;box-shadow:none;color:var(--ui-ink)}
        .qa-profile .route-elevation-profile>strong{font-size:12px;color:var(--ui-ink)}
        .qa-profile svg{display:block;width:100%;height:68px;overflow:visible}
        .qa-profile svg text{fill:var(--ui-muted);font:10px system-ui}
        .qa-bottom{position:absolute;z-index:7;left:0;right:0;bottom:0;height:64px;display:flex;align-items:center;justify-content:space-around;background:var(--ui-surface);color:var(--ui-muted);font-size:11px}
      `}</style>
      <main className="qa-frame" style={{ width, height: 780, ...tokens } as CSSProperties}>
      <div className="observatory home-map" data-ui-style="outdoor" data-guiding="true" style={{
        '--home-top': 'env(safe-area-inset-top, 0px)', '--home-left': '8px', '--home-right': '8px',
        '--home-bottom': 'env(safe-area-inset-bottom, 0px)', '--home-footer': 'calc(64px + var(--home-bottom))',
        '--home-header-height': '60px',
      } as CSSProperties}>
        <div className="qa-map" aria-hidden="true" />
        <GuidanceCard guidance={guidance} onStop={() => undefined} onFollow={() => undefined}
          onShow={() => undefined} following={false} onShare={() => undefined}
          onRally={() => undefined}
          telemetry={<NavigationTelemetry session={session} fix={null} />} />
        <button className="qa-rally-toggle" onClick={() => setShowRally((value) => !value)}>
          {showRally ? '隐藏底部海拔卡' : '显示底部海拔卡'}
        </button>
        {showRally && <RallyElevation route={rallyRoute} fraction={null} />}
        <div className="qa-profile">
          <RouteElevationProfile samples={samples} scale={syntheticScale} progress={samples.at(-1)!.distance * 0.58} selection={{distance:samples[18].distance,elevation:samples[18].elevation}} endpoints />
        </div>
        <nav className="qa-bottom" aria-label="底部导航"><span>地图</span><span>路线</span><span>记录</span><span>我的</span></nav>
      </div>
      </main>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
