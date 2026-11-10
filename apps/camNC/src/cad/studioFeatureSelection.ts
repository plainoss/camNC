import type { FeatureEntry } from './FeatureList';

/** A profile picker consumes sketch rows before ordinary feature/physical-part selection changes. */
export function selectStudioFeature(
  pickSketch: (partId: string) => boolean,
  selection: {
    sketch: (partId: string | null) => void;
    face: () => void;
    part: (partId: string) => void;
    entities: () => void;
  }
) {
  return (entry: FeatureEntry) => {
    const sketch = entry.kind === 'step' && entry.step.kind === 'sketch' ? entry.step.partId : null;
    if (sketch && pickSketch(sketch)) return;
    selection.sketch(sketch);
    selection.face();
    if (entry.kind === 'step') {
      selection.part(entry.step.partId);
      selection.entities();
    }
  };
}
