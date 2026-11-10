import {
  evaluateCadFeatures,
  evaluateCadPart,
  evaluateCadPartFamily,
  evaluatedPartCopy,
  withPartCuts,
  type CadPart,
  type CadDocument,
} from '@wbcnc/cad';
import type * as THREE from 'three';
import { modelGeometry } from '@/cam/model/modelGeometry';
import { nativePart } from '@/cam/nativeCadModel';

/**
 * The part as it'll be cut, or why it can't be shown. Uses the same mesh CAM reads back. Other parts of `document` cut
 * out of it are cut here too.
 */
export function partSolid(
  part: CadPart,
  document?: CadDocument,
  copyId?: string
): { geometry?: THREE.BufferGeometry; origin?: [number, number]; problem?: string } {
  const { part: profile } = evaluateCadPart(part);
  if (!profile) return { problem: 'This part can’t be shown until its sketch is fixed.' };
  // A cut with an error is left out and explained, so the part stays on screen while it's put right.
  const { part: evaluated, diagnostics } = evaluateCadFeatures(part, profile, copyId),
    problem = diagnostics.find(diagnostic => diagnostic.severity === 'error')?.message;
  try {
    const family = document && copyId ? evaluateCadPartFamily(part, profile).part : evaluated;
    const machined = document ? withPartCuts(document, family) : family;
    // A face sketch uses the original local frame, including on mirrors. Select the copy's material without reflecting its axes.
    const shape = copyId ? evaluatedPartCopy(machined, { id: copyId }) : machined;
    const { mesh, info } = nativePart(shape);
    return { geometry: modelGeometry(mesh), origin: info.sourceOrigin, problem };
  } catch (cause) {
    return { problem: cause instanceof Error ? cause.message : String(cause) };
  }
}
