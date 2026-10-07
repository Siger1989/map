// Non-destructive rectangle and intersection profiles; legacy shader clipping stays disconnected.
export const TERRAIN_SECTION_ENABLED = true;
// Independent release switch for offline geology industry tools.
export const INDUSTRY_TOOLS_ENABLED = true;
export const showIndustryToolsEntry = (enabled: boolean) => enabled;
export const mountIndustryToolsPanel = (enabled: boolean, panel: string | null) => enabled && panel === 'industry';
