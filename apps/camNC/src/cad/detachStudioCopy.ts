import { detachPartCopy, type CadDocument } from '@wbcnc/cad';
import { assemblyModel } from './assemblyModel';

/** The visible row placement of an unattached copy becomes an explicit placement when it is detached. */
export function detachStudioCopy(document: CadDocument, partId: string, copyId: string) {
  const placement = assemblyModel(document).placements.get(`${partId}/${copyId}`);
  const prepared = placement
    ? {
        ...document,
        parts: document.parts.map(part =>
          part.id !== partId
            ? part
            : {
                ...part,
                copies: part.copies?.map(copy => (copy.id === copyId ? { ...copy, placement } : copy)),
              }
        ),
      }
    : document;
  return detachPartCopy(prepared, partId, copyId);
}
