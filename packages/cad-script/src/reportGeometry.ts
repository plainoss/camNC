import {
  cadPartsToCut,
  copyOperationPrefix,
  evaluateCadDocument,
  physicalCadView,
  type CadDocument,
  type CadEvaluation,
  type EvaluatedCadPart,
} from '@wbcnc/cad';

export interface ReportGeometry {
  document: CadDocument;
  parts: readonly EvaluatedCadPart[];
  evaluation?: CadEvaluation;
}

/** Derived geometry only. Callers retain the raw source for settings, edits, hashes and saved documents. */
export function reportGeometry(source: CadDocument, parts: readonly EvaluatedCadPart[], evaluation?: CadEvaluation): ReportGeometry {
  if (source.operationOrder === undefined) return { document: source, parts };
  const state = evaluation ?? evaluateCadDocument(source);
  if (!state.available || !state.placements) return { document: { ...source, parts: [] }, parts: [], evaluation: state };
  // Ordered material and poses are one evaluated state. A legacy caller may still pass generation-only parts.
  const local = state.diagnostics.some(diagnostic => diagnostic.severity === 'error') ? [] : state.parts;
  return { ...physicalCadView(source, { ...state, parts: local }), evaluation: state };
}

/** Flat drawings use final CAM membership and per-copy material, while legacy drawings keep their established output. */
export function reportFlatParts(
  source: CadDocument,
  parts: readonly EvaluatedCadPart[],
  evaluation?: CadEvaluation
): readonly EvaluatedCadPart[] {
  if (source.operationOrder === undefined) return parts;
  const geometry = reportGeometry(source, parts, evaluation);
  return cadPartsToCut(geometry.document, geometry.parts).map(({ part, names }) => ({ ...part, name: names.join(', ') }));
}

/** Reporting uses the same valid saved prefix as Core, without changing the full source. */
export function reportPrefix(source: CadDocument, through?: string): CadDocument {
  return source.operationOrder === undefined ? source : copyOperationPrefix(source, through);
}
