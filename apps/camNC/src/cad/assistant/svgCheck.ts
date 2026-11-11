import type { CadDocument } from '@wbcnc/cad';
import { compactCadReport, type CadViewSelection } from '@wbcnc/cad-script';
import { checkSvgCandidate, type SvgPlacement } from '../../../../../packages/cad-script/src/svg';
import { svgAssetsForDocument } from '../svg/svgAssets';
import { plainAssistantData, assistantDataArray } from './recipeCatalog';
import { renderAssistantViews } from './designViews';
import { rasterizeAssistantView } from './images';
import { summarizeAssistantReport } from './report';

/** Data-only SVG tools share the manual import's document-local asset registry and candidate checker. */
export async function checkAssistantSvg(base: CadDocument, input: Record<string, unknown>, signal: AbortSignal, views: CadViewSelection) {
  const args = plainAssistantData(input, 'SVG request');
  if (Object.keys(args).some(key => !['source', 'handle', 'name', 'partName', 'thickness', 'placement'].includes(key)))
    throw new Error('Unknown SVG request field.');
  if (Number(Object.hasOwn(args, 'source')) + Number(Object.hasOwn(args, 'handle')) !== 1)
    throw new Error('Supply exactly one SVG source or stored handle.');
  for (const key of ['source', 'handle', 'name', 'partName'] as const)
    if (args[key] !== undefined && typeof args[key] !== 'string') throw new Error(`${key} must be text.`);
  if (args.thickness !== undefined && (typeof args.thickness !== 'number' || !Number.isFinite(args.thickness)))
    throw new Error('Thickness must be finite mm.');
  let placement: SvgPlacement | undefined;
  if (args.placement !== undefined) {
    const data = plainAssistantData(args.placement, 'SVG placement');
    if (Object.keys(data).some(key => !['width', 'height', 'at', 'preserveAspect'].includes(key)))
      throw new Error('Unknown SVG placement field.');
    for (const key of ['width', 'height'])
      if (data[key] !== undefined && (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || data[key] <= 0))
        throw new Error('SVG dimensions must be positive finite mm.');
    if (data.preserveAspect !== undefined && typeof data.preserveAspect !== 'boolean') throw new Error('preserveAspect must be boolean.');
    if (data.at !== undefined) {
      const at = assistantDataArray(data.at, 'SVG position');
      if (at.length !== 2 || at.some(value => typeof value !== 'number' || !Number.isFinite(value)))
        throw new Error('SVG position needs two finite mm coordinates.');
    }
    placement = structuredClone(data) as SvgPlacement;
  }
  signal.throwIfAborted();
  const store = svgAssetsForDocument(base.id);
  const handle =
    args.source !== undefined ? store.register(args.source as string, args.name as string | undefined).handle : (args.handle as string);
  const checked = await checkSvgCandidate(base, store, {
    handle,
    partName: args.partName as string | undefined,
    thickness: args.thickness as number | undefined,
    placement,
    toolpaths: false,
  });
  signal.throwIfAborted();
  const images = checked.ok
    ? await Promise.all(
        renderAssistantViews(checked.document, checked.parts, views).map(view => rasterizeAssistantView(view.svg, view.name))
      )
    : undefined;
  signal.throwIfAborted();
  const detailReport = compactCadReport(checked.document, checked.report);
  return { ...checked, trustedReport: checked.report, detailReport, report: summarizeAssistantReport(detailReport), images };
}
