import { edgeFilletProblems } from './edgeFillets';
import { resolveExtrudeSteps } from './extrudeSteps';
import { cadFaceSketches, faceIsUnderside } from './featureModel';
import { cadCopyName } from './partPatterns';
import { cadPartReferenceName, cadPartReferenceOwner } from './partReferences';
import type { CadDocument, CadLengthUnit, CadPart } from './types';
import { cadLengthUnitMm } from './sketchExport';
import { trimCadFolders } from './folderModel';
import { copyOperationPrefix } from './copyTransforms';
import { partCutInputErrors } from './partCutInputs';
import { partCutLabel, partCutVariableErrors } from './partCutVariables';
import { cadVariableScope } from './variables';
import { missingRegionProblem } from './regionProfile';

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
  /**
   * Why the step can't be built as it stands: what it was drawn on or adds to is suppressed, deleted or not extruded,
   * or the regions an Extrude picked are gone from its sketch.
   */
  broken?: string;
}

/** A typed length as the feature list reads it, in the design's unit. */
function typed(expression: string | undefined, value: number, lengthUnit: CadLengthUnit = 'mm') {
  const shown = `${+(value / cadLengthUnitMm[lengthUnit]).toFixed(3)} ${lengthUnit}`;
  // A plain number typed in the design's unit is saved as `(2) in`, which says no more than its value does.
  const literal = new RegExp(`^\\(?\\s*[+-]?(?:\\d+[.,]?\\d*|[.,]\\d+)\\s*\\)?\\s*${lengthUnit}$`);
  return expression && !literal.test(expression) ? `${expression} = ${shown}` : shown;
}

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
    return `remove ${part.remove.depth === 'through' ? 'through all' : typed(part.remove.depthExpression, part.remove.depth, document.lengthUnit)}`;
  return typed(part.thicknessExpression, part.thickness, document.lengthUnit);
}

const withPartCount = (detail: string, parts: number) => (parts > 1 ? `${detail} · ${parts} parts` : detail);

/** A sketch's name in the feature list, and wherever else the sketch is named. */
export function sketchStepLabel(part: CadPart): string {
  return part.sketchName ?? `Sketch · ${part.name}`;
}

/**
 * The design's steps: for each part in turn, its sketch and the thickness it's made to, the sketches and cuts on its
 * faces, and its copies. A step cutting parts out of others comes after the last of the parts it uses.
 */
export function designSteps(document: CadDocument): DesignStep[] {
  const broken = brokenParts(document);
  const byId = new Map(document.parts.map(part => [part.id, part]));
  const masked = new Set(document.folders?.filter(folder => folder.suppressed).flatMap(folder => folder.partIds));
  const partCutProblems = new Map<string, string>();
  // A tool or target that isn't built comes first: the step cuts less than it says whatever its values are.
  if (document.partCuts?.length)
    for (const { stepId, message } of [...partCutInputErrors(document), ...partCutVariableErrors(document, cadVariableScope(document))])
      if (!partCutProblems.has(stepId)) partCutProblems.set(stepId, message);
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
    // An Extrude whose picked regions an edit of its sketch took away waits for them to be picked again.
    const regions = step.kind === 'extrude' && part && !own ? missingRegionProblem(part) : null;
    const reason = (step.kind === 'sketch' || step.kind === 'extrude') && own ? own : (regions ?? onFace);
    // A Cut parts step whose typed values can't be followed keeps its last good ones, and says why on its row.
    const values = step.kind === 'partCut' ? partCutProblems.get(step.id) : undefined;
    // A Fillet step that can't round some of its corners leaves them sharp, and says so on its row. A part that's
    // switched off, itself or by its folder, isn't made, so neither is its fillet.
    const sharp =
      step.kind === 'fillet' && part && !step.suppressed && !part.suppressed && !masked.has(part.id)
        ? edgeFilletProblems(part).find(problem => problem.filletId === step.id)?.message
        : undefined;
    return reason || values || sharp ? { ...step, broken: reason || values || sharp } : step;
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
    if (broken.has(id) || missingRegionProblem(host)) return `${host.name}, which can’t be built`;
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
        label: partCutLabel(document, step),
        detail: `clearance ${typed(step.clearanceExpression, step.clearance, document.lengthUnit)}`,
        partId: owner?.id ?? reference,
        ...(owner && reference !== owner.id && { copyId: reference.slice(owner.id.length + 1) }),
        partCutId: step.id,
        suppressed: !!step.suppressed,
      },
    ]);
  }
  const byId = new Map(document.parts.map(part => [part.id, part]));
  const madeWith = (part: CadPart) => !!part.extrudedWith && !!byId.get(part.extrudedWith) && !byId.get(part.extrudedWith)!.extrudedWith;
  return document.parts.flatMap((part, partIndex) => {
    const steps: DesignStep[] = [
      // A part extruding another's sketch has none of its own.
      ...(part.sketchOf || part.faceProfile
        ? []
        : [{ id: `${part.id}:sketch`, kind: 'sketch' as const, label: sketchStepLabel(part), partId: part.id }]),
      // A sketch not yet extruded is only its sketch, and a part made by another's extrude is listed in that one.
      ...(part.extrude === false || madeWith(part)
        ? []
        : [
            {
              id: `${part.id}:extrude`,
              kind: 'extrude' as const,
              label: part.extrudeName ?? `${part.hole ? 'Hole' : 'Extrude'} · ${part.name}`,
              detail: withPartCount(
                extrudeDetail(document, part),
                1 + (part.extrudedWith ? 0 : document.parts.filter(other => other.extrudedWith === part.id).length)
              ),
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
          detail: feature.suppressed
            ? 'off'
            : feature.depth === 'through'
              ? 'through'
              : typed(feature.depthExpression, feature.depth, document.lengthUnit),
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
        detail: fillet.suppressed ? 'off' : `r ${typed(fillet.radiusExpression, fillet.radius, document.lengthUnit)}`,
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
          : `spacing ${typed(part.pattern.spacingExpression, part.pattern.spacing, document.lengthUnit)}`,
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
  if (document.operationOrder !== undefined) {
    if (document.operationOrder.includes(stepId)) return copyOperationPrefix(document, stepId);
    if (!designSteps(document).some(step => step.id === stepId)) return document;
    // Generation precedes the ordered spatial stream. A generation rollback removes that complete later stream.
    document = copyOperationPrefix(document);
  }
  const steps = designSteps(document);
  const at = steps.findIndex(step => step.id === stepId);
  if (at < 0 || at === steps.length - 1) return document;
  const kept = new Set(steps.slice(0, at + 1).map(step => step.id));
  // A part made by another's extrude is kept or rolled back with that extrude.
  const ids = new Set(steps.map(step => step.id));
  const extrudeOf = (part: CadPart) =>
    !ids.has(`${part.id}:extrude`) && part.extrudedWith ? `${part.extrudedWith}:extrude` : `${part.id}:extrude`;
  const parts = document.parts
    .filter(part => kept.has(part.sketchOf || part.faceProfile ? extrudeOf(part) : `${part.id}:sketch`))
    .map(part => {
      // Rolled back past its extrude, a part is only its sketch.
      const next: CadPart = kept.has(extrudeOf(part)) || part.extrude === false ? { ...part } : { ...part, extrude: false };
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
