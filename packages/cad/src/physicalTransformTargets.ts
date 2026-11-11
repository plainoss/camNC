import { isCadPart } from './features';
import { isJoinedBody } from './extrudeSteps';
import { cadPartReference } from './partReferences';
import type { CadDocument, CadPhysicalTarget, CadPhysicalTransform, CadPlacement } from './types';

/** The API requires a discriminated physical selection, not an optionally qualified family reference. */
export function physicalTargetIssue(target:unknown):string|null {
  if (!target || typeof target!=='object') return 'Choose an explicit physical target.';
  const value=target as Partial<CadPhysicalTarget>;
  if (typeof value.partId!=='string' || !value.partId) return 'Choose an explicit physical target.';
  if (value.kind==='seed') return 'copyId' in value && value.copyId!==undefined ?'A seed target cannot also select a copy.':null;
  return value.kind==='copy' && typeof value.copyId==='string' && value.copyId ?null:'Choose an explicit physical copy target.';
}

export const physicalTransformTarget=(move:CadPhysicalTransform):CadPhysicalTarget=>move.seed===true
  ?{kind:'seed',partId:move.partId}:{kind:'copy',partId:move.partId,copyId:move.copyId};

/** Internal pose-map key only. Cut parts source-family references retain their existing semantics. */
export const physicalTargetReference=(target:CadPhysicalTarget)=>target.kind==='seed' ?target.partId:cadPartReference(target.partId,target.copyId);

type Problem={code:string;message:string;severity:'warning'|'error'};
/**
 * A root seed move carries direct Add seed material atomically. Component seeds are not independent targets.
 * Authored own copies of a joined component retain their existing exact-copy support; synthetic inherited slots
 * are not authored operation targets and remain absent from available. Moving an own copy cannot rebase its seed.
 */
export function physicalTransformMembers(source:CadDocument,target:CadPhysicalTarget,available:ReadonlySet<string>,placements:ReadonlyMap<string,CadPlacement>):
  {references:string[]}|{problem:Problem} {
  const root=source.parts.find(part=>part.id===target.partId),reference=physicalTargetReference(target);
  const absent=():{problem:Problem}=>({problem:{code:target.kind==='copy' ?'copy-transform-target-missing':'physical-transform-target-missing',severity:'warning',message:
      `The transform target ${target.kind==='seed' ?'original part':'copy'} is not available: it is absent, suppressed, unplaced or already consumed at this operation. Restore it or choose another target.`}});
  if (target.kind==='seed' && root?.addTo!==undefined && root.extrude!==false && !root.suppressed)
    return {problem:{code:'physical-transform-seed-unsupported',severity:'error',message:'Transform the independent part that owns this joined component. A joined component is not an independent seed target.'}};
  if (!root || !available.has(reference)) return absent();
  if (target.kind==='seed' && !isCadPart(root))
    return {problem:{code:'physical-transform-seed-unsupported',severity:'error',message:'Choose an independent part for the original transform target.'}};
  if (!placements.has(reference)) return target.kind==='copy' ?absent():{problem:{code:'physical-transform-seed-unplaced',severity:'error',message:'The original part has no evaluated placement. Resolve its placement before applying this transform.'}};
  const references=[reference];
  if (target.kind==='seed')
    for (const part of source.parts) {
      if (part.addTo!==target.partId || !isJoinedBody(source,part) || !available.has(part.id)) continue;
      if (!placements.has(part.id)) return {problem:{code:'physical-transform-component-unplaced',severity:'error',message:'A joined component has no evaluated placement. Resolve its placement before moving the complete original part.'}};
      references.push(part.id);
    }
  return {references};
}
