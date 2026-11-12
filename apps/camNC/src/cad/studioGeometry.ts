import {
  activeDesign,
  cadPartsToCut,
  evaluateCadDocument,
  physicalCadView,
  type CadDiagnostic,
  type CadDocument,
  type CadEvaluation,
  type CadSolveResult,
  type EvaluatedCadPart,
} from '@wbcnc/cad';

export interface StudioGeometry {
  /** The only document that may be edited, saved or recorded in Undo. */
  source: CadDocument;
  /** A read-only view whose poses and membership match the evaluated occupied material. */
  document: CadDocument;
  /** Present for ordered source; legacy consumers retain their established evaluation path. */
  parts?: EvaluatedCadPart[];
  diagnostics: CadDiagnostic[];
}

const contexts = new WeakMap<CadDocument, StudioGeometry>();

/**
 * All application geometry readers share one ordered evaluation. Register its view as well as its source so
 * passing a projected document between readers cannot apply its moves or cuts a second time.
 * Source edits replace the document identity; this cache never owns editable source or persisted derived poses.
 */
function geometryContext(source: CadDocument, evaluated?: CadEvaluation): StudioGeometry {
  const cached = contexts.get(source);
  if (cached) return cached;
  if (source.operationOrder === undefined) return { source, document: source, diagnostics: [] };
  const evaluation = evaluated ?? evaluateCadDocument(source);
  const view =
    evaluation.available && evaluation.placements
      ? physicalCadView(source, evaluation)
      : { document: { ...activeDesign(source), parts: [] }, parts: [] };
  const context: StudioGeometry = {
    source,
    document: view.document,
    parts: view.parts,
    diagnostics: evaluation.diagnostics,
  };
  contexts.set(source, context);
  contexts.set(view.document, context);
  contexts.set(context.document, context);
  return context;
}

export const studioGeometry = (source: CadDocument): StudioGeometry => geometryContext(source);

/** Reuse the solver's complete physical result rather than evaluating cuts again for CAM. */
export const studioSolvedGeometry = (result: CadSolveResult): StudioGeometry => geometryContext(result.document, result);

export function studioCutParts(result: CadSolveResult) {
  const geometry = studioSolvedGeometry(result);
  return cadPartsToCut(geometry.document, geometry.parts ?? result.parts);
}
