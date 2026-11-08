import { cadFaceSketches, faceIsUnderside, type CadDocument, type CadPart } from '@wbcnc/cad';

/** One step of how the design is built, in the order it applies. */
export interface DesignStep {
  id: string;
  kind: 'sketch' | 'extrude' | 'faceSketch' | 'cut' | 'copy';
  label: string;
  /** A short reading of the step's main value, such as a thickness or depth. */
  detail?: string;
  partId: string;
  /** The face sketch or cut the step opens. */
  sketchId?: string;
  cutId?: string;
}

const typed = (expression: string | undefined, value: number) =>
  expression ? `${expression} = ${+value.toFixed(3)} mm` : `${+value.toFixed(3)} mm`;

function faceName(part: CadPart, on: ReturnType<typeof cadFaceSketches>[number]['on']) {
  if (typeof on === 'object') return faceIsUnderside(part, on) ? 'a pocket floor from below' : 'a pocket floor';
  return on === 'underside' ? 'the underside' : 'the top';
}

/**
 * The design's steps: for each part in turn, its sketch and the thickness it's made to, the sketches and cuts on its
 * faces, and its copies.
 */
export function designSteps(document: CadDocument): DesignStep[] {
  return document.parts.flatMap(part => {
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
    (part.copies ?? []).forEach((copy, index) =>
      steps.push({
        id: copy.id,
        kind: 'copy',
        label: `${copy.mirrored ? 'Mirrored copy' : 'Copy'} · ${part.name} ${index + 2}`,
        partId: part.id,
      })
    );
    return steps;
  });
}
