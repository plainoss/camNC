import { evaluateCadFeatures, evaluateCadPart, withPartCuts, type CadPart, type CadDocument } from '@wbcnc/cad';
import type * as THREE from 'three';
import { modelGeometry } from '@/cam/model/modelGeometry';
import { nativePart } from '@/cam/nativeCadModel';

/**
 * The part as it'll be cut, or why it can't be shown. Uses the same mesh CAM reads back. Other parts of `document` cut
 * out of it are cut here too.
 */
export function partSolid(
  part: CadPart,
  document?: CadDocument
): { geometry?: THREE.BufferGeometry; origin?: [number, number]; problem?: string } {
  const { part: profile } = evaluateCadPart(part);
  if (!profile) return { problem: 'This part can’t be shown until its sketch is fixed.' };
  // A cut with an error is left out and explained, so the part stays on screen while it's put right.
  const { part: evaluated, diagnostics } = evaluateCadFeatures(part, profile),
    problem = diagnostics.find(diagnostic => diagnostic.severity === 'error')?.message;
  try {
    const { mesh, info } = nativePart(document ? withPartCuts(document, evaluated) : evaluated);
    return { geometry: modelGeometry(mesh), origin: info.sourceOrigin, problem };
  } catch (cause) {
    return { problem: cause instanceof Error ? cause.message : String(cause) };
  }
}
