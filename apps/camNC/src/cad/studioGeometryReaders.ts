import { cadCornerSources, cadFaceFrame, physicalJoinedCopies, type CadDocument } from '@wbcnc/cad';
import { studioGeometry } from './studioGeometry';
import { assemblyModel, instanceKey, type AssemblyModel } from './assemblyModel';

/** Inspection reads the same physical poses as the meshes, never the saved creation placements. */
export function physicalFaceFrame(
  document: Parameters<typeof cadFaceFrame>[0],
  on: Parameters<typeof cadFaceFrame>[1],
  model?: AssemblyModel
) {
  const geometry = studioGeometry(document),
    view = geometry.document;
  if (geometry.parts && 'partId' in on) {
    const part = view.parts.find(part => part.id === on.partId);
    const copy = on.copyId && part?.copies?.find(copy => copy.id === on.copyId);
    if (part && (on.copyId ? copy && !copy.placement : !part.placement)) {
      const placement = (model ?? assemblyModel(document)).placements.get(instanceKey(on));
      if (placement)
        return cadFaceFrame(
          {
            ...view,
            parts: view.parts.map(part =>
              part.id !== on.partId
                ? part
                : {
                    ...part,
                    ...(on.copyId
                      ? { copies: part.copies!.map(copy => (copy.id === on.copyId ? { ...copy, placement } : copy)) }
                      : { placement }),
                  }
            ),
          },
          on
        );
    }
  }
  return cadFaceFrame(view, on);
}

export function physicalCornerSources(...[document, frame, except, source]: Parameters<typeof cadCornerSources>) {
  // Preserve Core's authored-corner eligibility. Virtual Add-body instances have no persistent copy entry
  // on their source, so Use must retain its explicit unsupported refusal rather than create a dangling link.
  const geometry = studioGeometry(document);
  const physical = cadCornerSources(geometry.document, frame, except, source);
  if (!geometry.source.operationOrder?.length) return physical;
  // Used points regenerate before spatial operations. A final-pose corner may coincide with a different creation
  // corner, so both its position key and complete source identity must agree before publishing a persistent link.
  const generation = cadCornerSources(geometry.source, frame, except, source);
  for (const [key, reference] of physical) {
    const original = generation.get(key);
    if (
      !original ||
      reference.partId !== original.partId ||
      reference.copyId !== original.copyId ||
      reference.pointId !== original.pointId ||
      reference.side !== original.side
    )
      physical.delete(key);
  }
  return physical;
}

/** Whether one physical instance is reflected, including an Add body's copy inherited from a mirrored host copy. */
export function physicalCopyMirrored(document: CadDocument, partId: string, copyId?: string) {
  if (!copyId) return false;
  // Legacy documents keep inherited Add-body copies out of their source, so derive them to find a mirrored host copy.
  const geometry = studioGeometry(document);
  const view = geometry.parts ? geometry.document : physicalJoinedCopies(document);
  return !!view.parts.find(part => part.id === partId)?.copies?.find(copy => copy.id === copyId)?.mirrored;
}
