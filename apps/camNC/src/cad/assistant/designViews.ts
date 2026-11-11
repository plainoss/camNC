import type { CadDocument, EvaluatedCadPart } from '@wbcnc/cad';
import { normalizeCadViewSelection, renderCadViews, type CadDrawing } from '@wbcnc/cad-script';

export const normalizeAssistantViews = normalizeCadViewSelection;

/** Only requested views are projected; callers rasterize/send exactly these returned drawings. */
export function renderAssistantViews(document: CadDocument, parts: readonly EvaluatedCadPart[], input: unknown): CadDrawing[] {
  return renderCadViews(document, parts, normalizeAssistantViews(input));
}
