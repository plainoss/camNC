import { createDocumentSvgAssetRegistry } from '../../../../../packages/cad-script/src/svg';
/** Shared by the manual Insert flow and the assistant's data-only SVG tools.
 * Source stays local to the document session; only summaries belong in model context.
 */
export const documentSvgAssets = createDocumentSvgAssetRegistry();
export const svgAssetsForDocument = (documentId: string) => documentSvgAssets.forDocument(documentId);
export const releaseSvgAssets = (documentId: string) => documentSvgAssets.release(documentId);
