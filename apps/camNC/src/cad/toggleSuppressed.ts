import type { CadDocument, CadPart } from '@wbcnc/cad';
import type { DesignStep } from './designSteps';

const flip = <T extends { suppressed?: true }>(item: T): T => {
  const next = { ...item };
  if (next.suppressed) delete next.suppressed;
  else next.suppressed = true;
  return next;
};

/** Switches a step of the design off in the feature list, or back on: an extrude, a transform, a pattern or a cut-parts step. */
export function toggleSuppressed(document: CadDocument, step: DesignStep): CadDocument {
  if (step.kind === 'partCut')
    return {
      ...document,
      revision: document.revision + 1,
      partCuts: (document.partCuts ?? []).map(cut => (cut.id === step.partCutId ? flip(cut) : cut)),
    };
  const change = (part: CadPart): CadPart => {
    if (step.kind === 'extrude') return flip(part);
    if (step.kind === 'pattern' && part.pattern) return { ...part, pattern: flip(part.pattern) };
    if (step.kind === 'fillet') return { ...part, fillets: part.fillets?.map(fillet => (fillet.id === step.id ? flip(fillet) : fillet)) };
    if (step.kind === 'copy') return { ...part, copies: part.copies?.map(copy => (copy.id === step.copyId ? flip(copy) : copy)) };
    return part;
  };
  return {
    ...document,
    revision: document.revision + 1,
    parts: document.parts.map(part => (part.id === step.partId ? change(part) : part)),
  };
}
