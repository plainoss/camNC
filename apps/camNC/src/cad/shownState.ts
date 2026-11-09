/**
 * What the eyes in the Parts and Features lists hide, kept per design in this browser so a reload shows the design as
 * it was left, as the reference does. It isn't part of the design, so it never makes an undo step.
 */
export interface CadShownState {
  /** Parts hidden by their eye: a part's ID, or `part/copy` for a copy. */
  hiddenParts: string[];
  /** Sketches, planes and the origin whose eye differs from how they start. */
  featureVisibility: Record<string, boolean>;
}

const key = (documentId: string) => `camnc:cad-shown:${documentId}`;

export function loadShownState(documentId: string): CadShownState {
  try {
    const saved = JSON.parse(localStorage.getItem(key(documentId)) ?? 'null') as Partial<CadShownState> | null;
    return {
      hiddenParts: Array.isArray(saved?.hiddenParts) ? saved.hiddenParts.filter(id => typeof id === 'string') : [],
      featureVisibility:
        saved?.featureVisibility && typeof saved.featureVisibility === 'object'
          ? Object.fromEntries(Object.entries(saved.featureVisibility).filter(([, shown]) => typeof shown === 'boolean'))
          : {},
    };
  } catch {
    return { hiddenParts: [], featureVisibility: {} };
  }
}

export function saveShownState(documentId: string, state: CadShownState) {
  try {
    if (!state.hiddenParts.length && !Object.keys(state.featureVisibility).length) localStorage.removeItem(key(documentId));
    else localStorage.setItem(key(documentId), JSON.stringify(state));
  } catch {
    // Storage may be full or blocked; what's shown then lasts only until the page reloads.
  }
}
