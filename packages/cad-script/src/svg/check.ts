import { createCadPart, parseCadDocument, type CadDocument } from '@wbcnc/cad';
import { inspectCadDocument } from '../inspect';
import { appendSvgToSketch } from './convert';
import type { SvgAssetStore } from './assets';
import type { SvgPlacement } from './types';
export interface CheckSvgOptions {
  handle: string;
  partName?: string;
  thickness?: number;
  placement?: SvgPlacement;
  /** Cheap geometry/solver check by default. Manual import can request CAM validation. */
  toolpaths?: boolean;
}
/** Trusted data-only candidate construction. No source evaluation or editor mutation.
 * Existing source identities remain intact; normal CAD checks decide whether the SVG
 * forms one valid part and whether its manufacturing profile can be planned.
 */
export async function checkSvgCandidate(base: CadDocument, store: SvgAssetStore, options: CheckSvgOptions) {
  const asset = store.get(options.handle),
    summary = store.summary(options.handle);
  const thickness = options.thickness ?? 18;
  if (!Number.isFinite(thickness) || thickness <= 0 || thickness > 10_000)
    throw new Error('SVG part thickness must be positive and at most 10000 mm.');
  const candidate = parseCadDocument(structuredClone(base));
  let name = options.partName?.trim() ?? 'Imported SVG';
  if (!name || name.length > 200 || [...name].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127))
    throw new Error('SVG part name must contain 1–200 printable characters.');
  if (options.partName !== undefined && candidate.parts.some(part => part.name === name))
    throw new Error(`There is already a part named ${name}. Choose a new SVG part name.`);
  if (options.partName === undefined) {
    let suffix = 2;
    while (candidate.parts.some(part => part.name === name)) name = `Imported SVG ${suffix++}`;
  }
  const part = createCadPart(name, thickness);
  part.sketch = appendSvgToSketch(part.sketch, asset, options.placement);
  candidate.parts.push(part);
  candidate.revision = base.revision + 1;
  const inspected = await inspectCadDocument(candidate, new Map(), { toolpaths: options.toolpaths ?? false });
  return { ok: inspected.report.ok, ...inspected, asset: summary, partId: part.id };
}
