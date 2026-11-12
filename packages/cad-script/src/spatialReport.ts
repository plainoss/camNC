import {
  cadPartReferenceOwner,
  cadPartsToCut,
  cadStepReport,
  copyOperationSteps,
  designSteps,
  evaluateCadDocument,
  placePoint,
  type CadCopyTransform,
  type CadSeedTransform,
  type CadDocument,
  type CadEvaluation,
  type CadPartCut,
  type CadPlacement,
  type CadStepReportEntry,
} from '@wbcnc/cad';
import { profileFeatures } from '@wbcnc/cam';
import { cadViewBodies, type CadViewBody } from './views/geometry';
import { reportGeometry, reportPrefix } from './reportGeometry';

type CutReport = Extract<CadStepReportEntry, { kind: 'partCut' }>;
export interface CadPhysicalReportBody {
  /** Stable physical reference, distinct from a source-family target's semantics. */
  id: string;
  partId: string;
  copyId?: string;
  name: string;
  placement: CadPlacement | null;
  /** World envelope of the evaluated profile. It does not assert that holes or cuts are filled. */
  bounds: { at: number[]; size: number[] } | null;
  cutIds: string[];
  /** Integral of this physical piece's CAM material layers, or the reason CAM cannot accept it. */
  cam?: { volume: number } | { problem: string };
}
interface SpatialStage {
  physical: CadPhysicalReportBody[];
  diagnosticCodes: string[];
  openings?: CutReport['cuts'];
}
export type CadSpatialReportOperation =
  // A seed move transforms a root's original instance; it is listed with the copy moves it is ordered among.
  (
    | { id: string; kind: 'copyTransform'; legacy: false; settings: Omit<CadCopyTransform, 'id'> | Omit<CadSeedTransform, 'id'> }
    | { id: string; kind: 'partCut'; legacy: boolean; label: string; broken?: string; settings: Omit<CadPartCut, 'id'> }
  ) & { after: SpatialStage };
export interface CadSpatialReport {
  /** Draft source contract: part/face generation precedes this ordered cut/pose stream. */
  scope: 'generation-before-spatial';
  through: string | null;
  operationOrder: string[];
  legacyPartCutIds: string[];
  operations: CadSpatialReportOperation[];
  physical: CadPhysicalReportBody[];
  camGroups: { partId: string; names: string[]; volume?: number; problem?: string }[];
}

function bounds(body: CadViewBody): CadPhysicalReportBody['bounds'] {
  if (!body.placement || !body.shape.outline.length) return null;
  const points = body.shape.outline.flatMap(point => [
    placePoint(body.placement, [point.x, point.y, 0]),
    placePoint(body.placement, [point.x, point.y, body.shape.thickness]),
  ]);
  const at = [0, 1, 2].map(axis => Math.min(...points.map(point => point[axis]!)));
  return { at, size: [0, 1, 2].map(axis => Math.max(...points.map(point => point[axis]!)) - at[axis]!) };
}

function physicalBodies(source: CadDocument, evaluation: CadEvaluation, includeCam: boolean): CadPhysicalReportBody[] {
  return cadViewBodies(source, evaluation.parts, evaluation).map(body => {
    const owner = cadPartReferenceOwner(source, body.id)!;
    const copyId = owner && body.id !== owner.id ? body.id.slice(owner.id.length + 1) : undefined;
    const profile = includeCam ? profileFeatures(body.shape) : undefined;
    const cam =
      profile &&
      (profile.problem
        ? { problem: profile.problem }
        : { volume: profile.features.levels.reduce((sum, level) => sum + level.z * level.area, 0) });
    return {
      id: body.id,
      partId: owner?.id ?? body.shape.partId,
      ...(copyId !== undefined && { copyId }),
      name: body.name,
      placement: body.placement ? structuredClone(body.placement) : null,
      bounds: bounds(body),
      cutIds: (body.shape.cuts ?? []).map(cut => cut.id),
      ...(cam && { cam }),
    };
  });
}

/** Historical results come from their own raw-source prefix, never from later material or final-pose recutting. */
export function spatialReport(source: CadDocument, evaluation: CadEvaluation): CadSpatialReport | undefined {
  if (source.operationOrder === undefined) return;
  const moves = new Map(source.copyTransforms?.map(move => [move.id, move])),
    cuts = new Map(source.partCuts?.map(cut => [cut.id, cut]));
  // The feature list's row for each Cut parts step: its name, and why it can't follow its values, if it can't.
  const listed = new Map(designSteps(source).map(step => [step.id, step]));
  const operations = copyOperationSteps(source).map((step): CadSpatialReportOperation => {
    const prefix = reportPrefix(source, step.id),
      state = evaluateCadDocument(prefix);
    const after: SpatialStage = {
      physical: physicalBodies(prefix, state, false),
      diagnosticCodes: state.diagnostics.map(diagnostic => diagnostic.code),
    };
    if (step.kind === 'copyTransform') {
      const { id, ...settings } = structuredClone(moves.get(step.id)!);
      return { id, kind: 'copyTransform', legacy: false, settings, after };
    }
    const { id, ...settings } = structuredClone(cuts.get(step.id)!);
    const opening = cadStepReport(prefix, state.parts).find((entry): entry is CutReport => entry.kind === 'partCut' && entry.stepId === id);
    if (opening) after.openings = opening.cuts;
    const row = listed.get(id);
    return {
      id,
      kind: 'partCut',
      legacy: step.legacy,
      label: row?.label ?? id,
      ...(row?.broken && { broken: row.broken }),
      settings,
      after,
    };
  });
  const geometry = reportGeometry(source, evaluation.parts, evaluation);
  const camGroups = cadPartsToCut(geometry.document, geometry.parts).map(group => {
    const profile = profileFeatures(group.part);
    return {
      partId: group.part.partId,
      names: [...group.names],
      ...(profile.problem
        ? { problem: profile.problem }
        : { volume: profile.features.levels.reduce((sum, level) => sum + level.z * level.area, 0) }),
    };
  });
  return {
    scope: 'generation-before-spatial',
    through: source.operationOrder.at(-1) ?? null,
    operationOrder: [...source.operationOrder],
    legacyPartCutIds: [...(source.legacyPartCutIds ?? [])],
    operations,
    physical: physicalBodies(source, evaluation, true),
    camGroups,
  };
}
