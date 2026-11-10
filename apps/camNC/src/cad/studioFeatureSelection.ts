import type { FeatureEntry } from './FeatureList';

/** A profile picker consumes sketch rows before ordinary feature/physical-part selection changes. */
export function selectStudioFeature(
  pickSketch: (partId: string) => boolean,
  selection: {
    sketch: (partId: string | null) => void;
    face: () => void;
    part: (partId: string, copyId?: string) => void;
    entities: () => void;
  }
) {
  return (entry: FeatureEntry) => {
    const sketch = entry.kind === 'step' && entry.step.kind === 'sketch' ? entry.step.partId : null;
    if (sketch && pickSketch(sketch)) return;
    selection.sketch(sketch);
    selection.face();
    if (entry.kind === 'step') {
      // A saved exact target must not widen to its source family when its feature row is selected.
      if (entry.step.kind === 'partCut' && entry.step.copyId !== undefined) selection.part(entry.step.partId, entry.step.copyId);
      else selection.part(entry.step.partId);
      selection.entities();
    }
  };
}
