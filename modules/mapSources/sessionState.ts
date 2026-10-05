export type SavedSourceFilter = 'all' | 'favorites' | 'online' | 'offline';
export type SourceCategory = 'builtin' | 'saved' | 'library';
export type MapSourcesStep = 'list' | 'library' | 'add' | 'camera' | 'preview';

type MapSourcesSessionState = {
  category: SourceCategory | null;
  savedQuery: string;
  savedFilter: SavedSourceFilter;
  libraryCategory: string;
  browseStep: 'list' | 'library';
  listScrollTop: number;
  libraryScrollTop: number;
};

// Transient chooser state only. Kept in memory for close/reopen during this app session.
const state: MapSourcesSessionState = {
  category: null,
  savedQuery: '',
  savedFilter: 'all',
  libraryCategory: '全球',
  browseStep: 'list',
  listScrollTop: 0,
  libraryScrollTop: 0,
};

export function getMapSourcesSessionState(): Readonly<MapSourcesSessionState> {
  return state;
}

export function updateMapSourcesSessionState(patch: Partial<MapSourcesSessionState>): void {
  Object.assign(state, patch);
}

export function rememberMapSourcesBrowseStep(step: MapSourcesStep): void {
  if (step === 'list' || step === 'library') updateMapSourcesSessionState({ browseStep: step });
}

export function mapSourcesBrowseStepToRestore(): 'list' | 'library' {
  return state.browseStep;
}

export function rememberMapSourcesBrowseScroll(step: MapSourcesStep, scrollTop: number): void {
  if (step === 'list') updateMapSourcesSessionState({ listScrollTop: scrollTop });
  if (step === 'library') updateMapSourcesSessionState({ libraryScrollTop: scrollTop });
}

export function mapSourcesBrowseScrollToRestore(step: MapSourcesStep, ready: boolean): number | null {
  if (step === 'list') return ready ? state.listScrollTop : null;
  if (step === 'library') return state.libraryScrollTop;
  return null;
}
