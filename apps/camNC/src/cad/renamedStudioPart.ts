import { designStepLabel, renamePartCopy, type CadDocument } from '@wbcnc/cad';
import { replacePart } from './editorHelpers';

/** The design with a part, or one of its copies, named anew. The part's features keep the names they had. */
export function renamedStudioPart(document: CadDocument, partId: string, copyId: string | null, name: string): CadDocument {
  if (copyId) return renamePartCopy(document, partId, copyId, name);
  return replacePart(document, partId, current => ({
    ...current,
    sketchName: current.sketchName ?? designStepLabel(document, `${partId}:sketch`),
    extrudeName: current.extrudeName ?? designStepLabel(document, `${partId}:extrude`),
    name,
  }));
}
