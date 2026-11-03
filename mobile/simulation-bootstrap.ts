import './installSimulationGeolocation';
import { simulationAllowed } from './installSimulationGeolocation';
if (import.meta.env.DEV && simulationAllowed) await import('./bootstrap.ts');
