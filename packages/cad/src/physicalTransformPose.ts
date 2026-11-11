import { turnAbout } from './placement';
import type { CadPlacement, CadRigidTransformValues } from './types';

/** One world rigid delta applies to the selected instance and every carried seed component. */
export function physicalTransformPose(current:CadPlacement,move:CadRigidTransformValues):CadPlacement|null {
  const turned=move.turn ?turnAbout(current,move.turn.about,move.turn.axis,move.turn.degrees):current;
  const position=turned.position.map((value,axis)=>value+move.by[axis]!) as [number,number,number];
  return [...position,...turned.rotation].every(Number.isFinite) ?{...turned,position}:null;
}
