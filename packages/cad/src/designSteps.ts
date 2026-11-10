import { resolveExtrudeSteps } from './extrudeSteps';
import { cadFaceSketches, faceIsUnderside } from './featureModel';
import { cadCopyName } from './partPatterns';
import { cadPartReferenceName, cadPartReferenceOwner } from './partReferences';
import type { CadDocument, CadPart } from './types';
import { trimCadFolders } from './folderModel';

/** One step of how the design is built, in the order it applies. */
export interface DesignStep {
  id: string;
  kind: 'sketch' | 'extrude' | 'move' | 'faceSketch' | 'cut' | 'fillet' | 'copy' | 'pattern' | 'partCut';
  label: string;
  /** A short reading of the step's main value, such as a thickness or depth. */
  detail?: string;
  partId: string;
  /** The face sketch or cut the step opens. */
  sketchId?: string;
  cutId?: string;
  /** The "cut parts" step it stands for. */
  partCutId?: string;
  /** The copy it made, or the physical copy targeted by a Cut parts step. */
  copyId?: string;
  /** Switched off in the feature list. */
  suppressed?: boolean;
  /** Why the step can't be built as it stands: what it was drawn on or adds to is suppressed, deleted or not extruded. */
  broken?: string;
}

const typed = (expression: string | undefined, value: number) =>
  expression ? `${expression} = ${+value.toFixed(3)} mm` : `${+value.toFixed(3)} mm`;

function faceName(part: CadPart, on: ReturnType<typeof cadFaceSketches>[number]['on']) {
  if (typeof on === 'object') return faceIsUnderside(part, on) ? 'a pocket floor from below' : 'a pocket floor';
  return on === 'underside' ? 'the underside' : 'the top';
}

const names = (document: CadDocument, ids: string[]) => ids.map(id => cadPartReferenceName(document, id) ?? 'a removed part').join(', ');

/** What an extrude does: the thickness of a new part, the part it adds to, or how deep it removes. */
function extrudeDetail(document: CadDocument, part: CadPart) {
  if (part.addTo === '') return 'choose merge scope';
  if (part.addTo) return `add to ${names(document, [part.addTo])}`;
  if (part.remove)
    return `remove ${part.remove.depth === 'through' ? 'through all' : typed(part.remove.depthExpression, part.remove.depth)}`;
  return typed(part.thicknessExpression, part.thickness);
}

/**
 * The design's steps: for each part in turn, its sketch and the thickness it's made to, the sketches and cuts on its
 * faces, and its copies. A step cutting parts out of others comes after the last of the parts it uses.
 */
export function designSteps(document: CadDocument): DesignStep[] {
  const broken = brokenParts(document);
  const byId = new Map(document.parts.map(part => [part.id, part]));
  const masked = new Set(document.folders?.filter(folder => folder.suppressed).flatMap(folder => folder.partIds));
  return listedSteps(document).map(step => {
    const own = broken.get(step.partId);
    const part = byId.get(step.partId);
    // A sketch or cut on a part's own face needs that part to be there.
    const onFace =
      (step.kind === 'faceSketch' || step.kind === 'cut') && part
        ? part.suppressed || masked.has(part.id)
          ? `It’s on ${part.name}, which is suppressed.`
          : own && `It’s on ${part.name}, which can’t be built.`
        : null;
    const reason = (step.kind === 'sketch' || step.kind === 'extrude') && own ? own : onFace;
    return reason ? { ...step, broken: reason } : step;
  });
}

/**
 * The parts that can't be built because a part they need is gone: the part whose face they're drawn on, or the part
 * they add to, is suppressed, deleted or only a sketch, or is itself broken. Each says why.
 */
export function brokenParts(document: CadDocument): Map<string, string> {
  const byId = new Map(document.parts.map(part => [part.id, part]));
  const masked = new Set(document.folders?.filter(folder => folder.suppressed).flatMap(folder => folder.partIds));
  const broken = new Map<string, string>();
  const missing = (id: string): string | null => {
    const host = byId.get(id);
    if (!host) return 'a deleted part';
    if (host.suppressed || masked.has(host.id)) return `${host.name}, which is suppressed`;
    if (host.extrude === false) return `${host.name}, which isn’t extruded`;
    if (broken.has(id)) return `${host.name}, which can’t be built`;
    return null;
  };
  // In order, so a part built on a broken one is broken too.
  for (let changed = true; changed; ) {
    changed = false;
    for (const part of document.parts) {
      if (broken.has(part.id)) continue;
      const on = part.drawnOn?.on;
      const face =
        on && 'partId' in on
          ? missing(on.partId) ||
            (() => {
              if (!on.copyId) return null;
              const host = byId.get(on.partId)!;
              const copy = host.copies?.find(copy => copy.id === on.copyId);
              if (!copy) return 'a deleted copy';
              if (copy.suppressed || (copy.pattern && host.pattern?.suppressed)) return 'a suppressed copy';
              if (
                copy.pattern &&
                host.pattern &&
                !Array.from({ length: Math.max(0, host.pattern.count - 1) }, (_, i) => `${host.pattern!.id}:${i + 1}`).includes(copy.id)
              )
                return 'a deleted copy';
              return null;
            })()
          : null;
      const adds = part.addTo ? missing(part.addTo) : null;
      const reason = face ? `It’s drawn on a face of ${face}.` : adds ? `It adds to ${adds}.` : null;
      if (reason) {
        broken.set(part.id, reason);
        changed = true;
      }
    }
  }
  return broken;
}

function listedSteps(document: CadDocument): DesignStep[] {
  const order = new Map(document.parts.map((part, index) => [part.id, index]));
  const after = new Map<number, DesignStep[]>();
  for (const step of document.partCuts ?? []) {
    const reference = step.targets[0] ?? step.tools[0]!;
    const owner = cadPartReferenceOwner(document, reference);
    const last = Math.max(0, ...[...step.tools, ...step.targets].map(id => order.get(cadPartReferenceOwner(document, id)?.id ?? id) ?? 0));
    after.set(last, [
      ...(after.get(last) ?? []),
      {
        id: step.id,
        kind: 'partCut',
        label: `Cut ${names(document, step.targets)} with ${names(document, step.tools)}`,
        detail: `clearance ${typed(step.clearanceExpression, step.clearance)}`,
        partId: owner?.id ?? reference,
        ...(owner && reference !== owner.id && { copyId: reference.slice(owner.id.length + 1) }),
        partCutId: step.id,
        suppressed: !!step.suppressed,
      },
    ]);
  }
  return document.parts.flatMap((part, partIndex) => {
    const steps: DesignStep[] = [
      // A part extruding another's sketch has none of its own.
      ...(part.sketchOf || part.faceProfile
        ? []
        : [{ id: `${part.id}:sketch`, kind: 'sketch' as const, label: part.sketchName ?? `Sketch · ${part.name}`, partId: part.id }]),
      // A sketch not yet extruded is only its sketch.
      ...(part.extrude === false
        ? []
        : [
            {
              id: `${part.id}:extrude`,
              kind: 'extrude' as const,
              label: part.extrudeName ?? `${part.hole ? 'Hole' : 'Extrude'} · ${part.name}`,
              detail: extrudeDetail(document, part),
              partId: part.id,
              suppressed: !!part.suppressed,
            },
          ]),
      // Moved without copying, by a Transform of its own.
      ...(part.moved
        ? [
            {
              id: `${part.id}:move`,
              kind: 'move' as const,
              label: `Transform · ${part.name}`,
              detail:
                'by' in part.moved
                  ? `${part.moved.turn ? `turned ${+part.moved.turn.degrees.toFixed(3)}°, ` : ''}moved ${part.moved.by.map(value => +value.toFixed(3)).join(', ')} mm`
                  : `moved ${+part.moved.distance.toFixed(3)} mm`,
              partId: part.id,
            },
          ]
        : []),
    ];
    let cut = 0;
    const featureName = (copyId?: string) => {
      if (!copyId) return part.name;
      const index = part.copies?.findIndex(copy => copy.id === copyId) ?? -1;
      return index >= 0 ? cadCopyName(part, index) : `${part.name} · absent copy`;
    };
    const absent = (copyId?: string) =>
      copyId && !part.copies?.some(copy => copy.id === copyId)
        ? 'This copy is absent. Restore its pattern count to build these features.'
        : undefined;
    for (const feature of part.features ?? []) {
      // What an Extrude → Remove cuts is that step's, listed where it is.
      if (feature.removedBy) continue;
      if (feature.type === 'sketch')
        steps.push({
          id: feature.id,
          kind: 'faceSketch',
          label: `Sketch on ${faceName(part, feature.on)} · ${featureName(feature.copyId)}`,
          partId: part.id,
          sketchId: feature.sketch.id,
          ...(feature.copyId && { copyId: feature.copyId }),
          broken: absent(feature.copyId),
        });
      else {
        cut++;
        steps.push({
          id: feature.id,
          kind: 'cut',
          label: `Cut ${cut} · ${featureName(feature.copyId)}`,
          detail: feature.suppressed ? 'off' : feature.depth === 'through' ? 'through' : typed(feature.depthExpression, feature.depth),
          partId: part.id,
          suppressed: !!feature.suppressed,
          cutId: feature.id,
          sketchId: feature.sketchId,
          ...(feature.copyId && { copyId: feature.copyId }),
          broken: absent(feature.copyId),
        });
      }
    }
    for (const fillet of part.fillets ?? [])
      steps.push({
        id: fillet.id,
        kind: 'fillet',
        label: `Fillet · ${part.name}`,
        detail: fillet.suppressed ? 'off' : `r ${typed(fillet.radiusExpression, fillet.radius)}`,
        partId: part.id,
        suppressed: !!fillet.suppressed,
      });
    (part.copies ?? []).forEach((copy, index) => {
      if (!copy.pattern)
        steps.push({
          id: copy.id,
          kind: 'copy',
          label: `${copy.offset ? 'Transform' : copy.mirrored ? 'Mirrored copy' : 'Copy'} · ${cadCopyName(part, index)}`,
          partId: part.id,
          copyId: copy.id,
          suppressed: !!copy.suppressed,
        });
    });
    if (part.pattern)
      steps.push({
        id: part.pattern.id,
        kind: 'pattern',
        label: part.pattern.circular
          ? `Circular pattern · ${part.name} × ${part.pattern.count}`
          : `Pattern · ${part.name} × ${part.pattern.count} along ${part.pattern.axis}`,
        detail: part.pattern.circular
          ? `angle ${part.pattern.circular.angleExpression ? `${part.pattern.circular.angleExpression} = ` : ''}${+part.pattern.circular.angle.toFixed(3)}°`
          : `spacing ${typed(part.pattern.spacingExpression, part.pattern.spacing)}`,
        partId: part.id,
        suppressed: !!part.pattern.suppressed,
      });
    return [...steps, ...(after.get(partIndex) ?? [])];
  });
}

/**
 * The design as it was built up to and including one of its steps, as the studio shows it while that step is edited:
 * parts made after it are gone, and so are later cuts, copies, patterns and cut-parts steps.
 */
export function rolledBackTo(document: CadDocument, stepId: string): CadDocument {
  const steps = designSteps(document);
  const at = steps.findIndex(step => step.id === stepId);
  if (at < 0 || at === steps.length - 1) return document;
  const kept = new Set(steps.slice(0, at + 1).map(step => step.id));
  const parts = document.parts
    .filter(part => kept.has(`${part.id}:${part.sketchOf || part.faceProfile ? 'extrude' : 'sketch'}`))
    .map(part => {
      // Rolled back past its extrude, a part is only its sketch.
      const next: CadPart = kept.has(`${part.id}:extrude`) || part.extrude === false ? { ...part } : { ...part, extrude: false };
      // What Remove steps cut follows from those steps, below.
      // Rolled back past its move, a part sits where it's drawn.
      if (!kept.has(`${part.id}:move`)) delete next.moved;
      if (part.features) next.features = part.features.filter(feature => !feature.removedBy && kept.has(feature.id));
      const pattern = part.pattern && kept.has(part.pattern.id);
      if (!pattern) delete next.pattern;
      const copies = (part.copies ?? []).filter(copy => (copy.pattern ? pattern : kept.has(copy.id)));
      if (copies.length) next.copies = copies;
      else delete next.copies;
      const fillets = part.fillets?.filter(fillet => kept.has(fillet.id));
      if (fillets?.length) next.fillets = fillets;
      else delete next.fillets;
      return next;
    });
  const next: CadDocument = { ...document, parts };
  const partCuts = (document.partCuts ?? []).filter(step => kept.has(step.id));
  if (partCuts.length) next.partCuts = partCuts;
  else delete next.partCuts;
  // Add and Remove steps kept still add and cut; shared sketches go to the first part left that uses them.
  return resolveExtrudeSteps(trimCadFolders(next));
}
