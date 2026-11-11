import type { CadDocument, DesignStep } from '@wbcnc/cad';
import type { ExportTarget } from './ExportDialog';

/** The sketch a Sketch or face Sketch row stands for, named as the row is. */
export function sketchExportTarget(document: CadDocument, step: DesignStep): ExportTarget | null {
  const part = document.parts.find(candidate => candidate.id === step.partId);
  if (!part) return null;
  if (step.kind === 'sketch') return { kind: 'sketch', name: step.label, sketch: part.sketch };
  if (step.kind !== 'faceSketch') return null;
  const feature = part.features?.find(candidate => candidate.type === 'sketch' && candidate.sketch.id === step.sketchId);
  return feature?.type === 'sketch' ? { kind: 'sketch', name: step.label, sketch: feature.sketch } : null;
}
