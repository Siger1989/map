import { createContext } from 'react';
import type { ShareMapStyle } from './currentMapStyle';

/** Read only when generating, so each new image uses the current layer choices. */
export const CurrentMapContext = createContext<(() => ShareMapStyle | null) | null>(null);
