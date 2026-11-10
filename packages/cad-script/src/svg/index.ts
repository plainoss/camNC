export { parseSvgSketch } from './parse';
export { appendSvgToSketch, placedSvgSegments } from './convert';
export { createSvgAssetStore, type SvgAssetStore, type SvgAssetSummary } from './assets';
export { geometryBounds, evaluateSegment } from './bounds';
export {
  SVG_LIMITS,
  type SvgBounds,
  type SvgContour,
  type SvgPlacement,
  type SvgPoint,
  type SvgSegment,
  type SvgSketchAsset,
} from './types';

export { checkSvgCandidate, type CheckSvgOptions } from './check';
export { createDocumentSvgAssetRegistry } from './registry';
