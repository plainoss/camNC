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
import { studioGeometry } from './studioGeometry';

const drafts = new WeakMap<CadDocument, WeakMap<CadPart, CadDocument>>();

/** The document with `part` in place of its saved version; the same document when they agree, so its evaluation is reused. */
function documentWithDraft(document: CadDocument, part: CadPart): CadDocument {
  const saved = document.parts.find(candidate => candidate.id === part.id);
  // Callers often pass an equal copy of the saved part; re-evaluating the whole ordered design for it would be wasted.
  if (saved === part || (saved && JSON.stringify(saved) === JSON.stringify(part))) return document;
  const byPart = drafts.get(document) ?? new WeakMap<CadPart, CadDocument>();
  drafts.set(document, byPart);
  let draft = byPart.get(part);
  if (!draft) {
    draft = {
      ...document,
      parts: saved ? document.parts.map(candidate => (candidate.id === part.id ? part : candidate)) : [...document.parts, part],
    };
    byPart.set(part, draft);
  }
  return draft;
}

/**
 * The part as it'll be cut, or why it can't be shown. Uses the same mesh CAM reads back. Other parts of `document` cut
 * out of it are cut here too.
 */
export function partSolid(
  part: CadPart,
  document?: CadDocument,
  copyId?: string
): { geometry?: THREE.BufferGeometry; origin?: [number, number]; problem?: string } {
  // A drag preview passes a draft of the part, or one not saved yet: evaluate the document with that draft in it.
  const withDraft = document?.operationOrder !== undefined ? documentWithDraft(document, part) : document;
  const geometry = withDraft && studioGeometry(withDraft);
  if (geometry?.parts) {
    const source = geometry.document.parts.find(source => source.id === part.id);
    const material = geometry.parts.find(shape => shape.partId === part.id);
    if (!source || !material || (copyId && !source.copies?.some(copy => copy.id === copyId)))
      return { problem: 'This physical part or copy is not available at this step.' };
    try {
      // The stage already owns the occupied material. The local face editor retains unreflected sketch axes.
      const shape = copyId ? evaluatedPartCopy(material, { id: copyId }) : material;
      const { mesh, info } = nativePart(shape);
      return {
        geometry: modelGeometry(mesh),
        origin: info.sourceOrigin,
        problem: geometry.diagnostics.find(diagnostic => diagnostic.partId === part.id)?.message,
      };
    } catch (cause) {
      return { problem: cause instanceof Error ? cause.message : String(cause) };
    }
  }
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
