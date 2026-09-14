/** Compatibility entry point; new consumers should import the responsible dataTransfer module. */
export { DATA_CHANGED, type Transfer } from '../dataTransfer/types.ts';
export { validateTransfer } from '../dataTransfer/validation.ts';
export { collectData, mergeData } from '../dataTransfer/storage.ts';
export { parseFile } from '../dataTransfer/fileImport.ts';
export { exportGPX, exportKML } from '../dataTransfer/xmlExport.ts';
export { saveFile } from '../dataTransfer/download.ts';
