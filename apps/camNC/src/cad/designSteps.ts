import { cadCopyName, cadFaceSketches, faceIsUnderside, type CadDocument, type CadPart } from '@wbcnc/cad';

/** One step of how the design is built, in the order it applies. */
export interface DesignStep {
  id: string;
  kind: 'sketch' | 'extrude' | 'faceSketch' | 'cut' | 'copy' | 'pattern' | 'partCut';
  label: string;
  /** A short reading of the step's main value, such as a thickness or depth. */
  detail?: string;
  partId: string;
  /** The face sketch or cut the step opens. */
  sketchId?: string;
  cutId?: string;
  /** The "cut parts" step it stands for. */
  partCutId?: string;
  /** The copy it made. */
  copyId?: string;
}

const typed = (expression: string | undefined, value: number) =>
  expression ? `${expression} = ${+value.toFixed(3)} mm` : `${+value.toFixed(3)} mm`;

function faceName(part: CadPart, on: ReturnType<typeof cadFaceSketches>[number]['on']) {
  if (typeof on === 'object') return faceIsUnderside(part, on) ? 'a pocket floor from below' : 'a pocket floor';
  return on === 'underside' ? 'the underside' : 'the top';
}

const names = (document: CadDocument, ids: string[]) =>
  ids.map(id => document.parts.find(part => part.id === id)?.name ?? 'a removed part').join(', ');

/**
 * The design's steps: for each part in turn, its sketch and the thickness it's made to, the sketches and cuts on its
 * faces, and its copies. A step cutting parts out of others comes after the last of the parts it uses.
 */
export function designSteps(document: CadDocument): DesignStep[] {
  const order = new Map(document.parts.map((part, index) => [part.id, index]));
  const after = new Map<number, DesignStep[]>();
  for (const step of document.partCuts ?? []) {
    const last = Math.max(0, ...[...step.tools, ...step.targets].map(id => order.get(id) ?? 0));
    after.set(last, [
      ...(after.get(last) ?? []),
      {
        id: step.id,
        kind: 'partCut',
        label: `Cut ${names(document, step.targets)} with ${names(document, step.tools)}`,
        detail: `clearance ${typed(step.clearanceExpression, step.clearance)}`,
        partId: step.targets[0] ?? step.tools[0]!,
        partCutId: step.id,
      },
    ]);
  }
  return document.parts.flatMap((part, partIndex) => {
    const steps: DesignStep[] = [
      { id: `${part.id}:sketch`, kind: 'sketch', label: `Sketch · ${part.name}`, partId: part.id },
      {
        id: `${part.id}:extrude`,
        kind: 'extrude',
        label: `Extrude · ${part.name}`,
        detail: typed(part.thicknessExpression, part.thickness),
        partId: part.id,
      },
    ];
    let cut = 0;
    for (const feature of part.features ?? []) {
      if (feature.type === 'sketch')
        steps.push({
          id: feature.id,
          kind: 'faceSketch',
          label: `Sketch on ${faceName(part, feature.on)} · ${part.name}`,
          partId: part.id,
          sketchId: feature.sketch.id,
        });
      else {
        cut++;
        steps.push({
          id: feature.id,
          kind: 'cut',
          label: `Cut ${cut} · ${part.name}`,
          detail: feature.suppressed ? 'off' : feature.depth === 'through' ? 'through' : typed(feature.depthExpression, feature.depth),
          partId: part.id,
          cutId: feature.id,
          sketchId: feature.sketchId,
        });
      }
    }
    (part.copies ?? []).forEach((copy, index) => {
      if (!copy.pattern)
        steps.push({
          id: copy.id,
          kind: 'copy',
          label: `${copy.offset ? 'Transform' : copy.mirrored ? 'Mirrored copy' : 'Copy'} · ${cadCopyName(part, index)}`,
          partId: part.id,
          copyId: copy.id,
        });
    });
    if (part.pattern)
      steps.push({
        id: part.pattern.id,
        kind: 'pattern',
        label: `Pattern · ${part.name} × ${part.pattern.count} along ${part.pattern.axis}`,
        detail: `spacing ${typed(part.pattern.spacingExpression, part.pattern.spacing)}`,
        partId: part.id,
      });
    return [...steps, ...(after.get(partIndex) ?? [])];
  });
}
