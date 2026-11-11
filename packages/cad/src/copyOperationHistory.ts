import { cadPartReferenceName } from './partReferences';
import { physicalTargetReference, physicalTransformTarget } from './physicalTransformTargets';
import type { CadDocument, CadPhysicalTarget } from './types';

/** Spatial stages are separate from creation/face generators until their history UI adopts this source contract. */
export interface CadSpatialStep {
  id: string;
  kind: 'partCut' | 'copyTransform';
  partId: string;
  copyId?: string;
  target?:CadPhysicalTarget;
  label: string;
  suppressed: boolean;
  legacy: boolean;
}

export function copyOperationSteps(document: CadDocument): CadSpatialStep[] {
  const cuts = new Map(document.partCuts?.map(cut => [cut.id, cut]));
  const transforms = new Map(document.copyTransforms?.map(move => [move.id, move]));
  return (document.operationOrder ?? []).flatMap((id): CadSpatialStep[] => {
    const move = transforms.get(id);
    if (move)
      return [
        {
          id,
          kind: 'copyTransform',
          partId: move.partId,
          copyId: move.copyId,
          target:physicalTransformTarget(move),
          label: `Transform${move.seed===true ?' original':''} · ${cadPartReferenceName(document,physicalTargetReference(physicalTransformTarget(move))) ?? (move.seed===true ?'missing original':'missing copy')}`,
          suppressed: !!move.suppressed,
          legacy: false,
        },
      ];
    const cut = cuts.get(id);
    return cut
      ? [
          {
            id,
            kind: 'partCut',
            partId: cut.targets[0] ?? cut.tools[0]!,
            label: `Cut ${cut.targets.map(reference => cadPartReferenceName(document, reference) ?? 'missing target').join(', ')}`,
            suppressed: !!cut.suppressed,
            legacy: !!document.legacyPartCutIds?.includes(id),
          },
        ]
      : [];
  });
}
