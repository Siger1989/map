import { cadReferenceFeatureCollections } from '../../cad/CadLayer.ts';
import { readCadDocuments } from '../../cad/storage.ts';
import type { FeatureCollection } from 'geojson';

/** Keep the original CAD archive and placement pipeline; transport only the already projected map geometry. */
export async function readNativeCadGeometry(signal?: AbortSignal): Promise<FeatureCollection> {
  const documents = await readCadDocuments(); signal?.throwIfAborted();
  const { features, labels } = cadReferenceFeatureCollections(documents);
  return { type: 'FeatureCollection', features: [
    ...features.features.map(feature => ({ ...feature, properties: { ...feature.properties, role: 'cad',
      color: feature.properties.cadColor, width: 1.5, pointSize: 7, fillOpacity: 0.12,
      nativePick: { kind: 'cad', documentId: feature.properties.cadDocumentId, featureId: feature.properties.cadFeatureId } } })),
    ...labels.features.map(feature => ({ ...feature, properties: { ...feature.properties, role: 'cadLabel',
      color: feature.properties.cadColor, label: feature.properties.cadText, pointSize: 0 } })),
  ] };
}
