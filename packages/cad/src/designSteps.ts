import { cadPartsMissingVariables, kVariableMissing } from './variables';
import { cadCuts } from './featureModel';
import { mergedWithAll } from './unionParts';
import { evaluateCadPart } from './geometry';
import { filletProblems } from './filletProblems';
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
import { missingRegionMessage, missingRegionProblem } from './regionProfile';

/** One step of how the design is built, in the order it applies. */
export interface DesignStep {
  id: string;
  kind: 'sketch' | 'extrude' | 'move' | 'faceSketch' | 'cut' | 'fillet' | 'mirror' | 'copy' | 'pattern' | 'partCut' | 'split';
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

/** A part named as a new one is, "Part 3", rather than by the person. */
const kDefaultPartName = /^Part \d+$/;

/**
 * The steps with sketches, extrudes and holes numbered in design order, as "Sketch 2" or "Extrude 3", for parts still
 * named as new parts are. A step or part the person named keeps that name.
 */
function numberedSteps(document: CadDocument, steps: DesignStep[]): DesignStep[] {
  const byId = new Map(document.parts.map(part => [part.id, part]));
  const counts = new Map<string, number>();
  // A name kept from before, as when an earlier step was deleted, isn't given again.
  const taken = new Set(steps.map(step => step.label));
  return steps.map(step => {
    // A transform of a part, or a copy of it moved, is numbered as Transform N.
    const transform = (step.kind === 'copy' || step.kind === 'move') && step.label.startsWith('Transform · ');
    if (step.kind !== 'sketch' && step.kind !== 'extrude' && step.kind !== 'fillet' && step.kind !== 'mirror' && !transform) return step;
    const part = byId.get(step.partId);
    const noun =
      step.kind === 'sketch'
        ? 'Sketch'
        : step.kind === 'fillet'
          ? 'Fillet'
          : transform
            ? 'Transform'
            : step.kind === 'mirror'
              ? 'Mirror'
              : part?.hole
                ? 'Hole'
                : 'Extrude';
    const own = step.kind === 'sketch' ? part?.sketchName : step.kind === 'extrude' ? part?.extrudeName : undefined;
    let n = (counts.get(noun) ?? 0) + 1;
    if (!own) while (taken.has(`${noun} ${n}`)) n++;
    counts.set(noun, n);
    // A fillet has no name of its own, so it's always numbered.
    return part && !own && (step.kind === 'fillet' || step.kind === 'mirror' || transform || kDefaultPartName.test(part.name))
      ? { ...step, label: `${noun} ${n}` }
      : step;
  });
}

/** The name a step of the design goes by, as the feature list shows it. */
export function designStepLabel(document: CadDocument, stepId: string): string | undefined {
  return listedSteps(document).find(step => step.id === stepId)?.label;
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
    // An Extrude whose picked regions an edit of its sketch took away waits for them to be picked again; an Add with its
    // merge scope emptied, while its dialog is open, waits for the parts to merge with.
    const regions =
      step.kind === 'extrude' && part && !own
        ? (missingRegionProblem(part) ??
          (part.addTo === '' && !part.mergeAll ? 'Select the parts to merge with. 1 missing selection' : null))
        : null;
    // A sketch or extrude that lost what it stands on is missing its picks, and says so as the reference does.
    // The face it's drawn on gone takes its picked regions with it; a part it adds to or removes from gone is one more.
    const faceLost = !!own && own.startsWith('It’s drawn on');
    const hostLost = !!part && (faceLost || !!own?.startsWith('It adds')) && !!(part.remove || part.addTo);
    const missing = (faceLost ? part?.regions?.length || 1 : 0) + (hostLost ? 1 : 0);
    const lost =
      step.kind === 'sketch' && faceLost
        ? 'Select a sketch plane. 1 missing selection'
        : step.kind === 'extrude' && missing
          ? missingRegionMessage(missing)
          : step.kind === 'extrude'
            ? own
            : // A sketch is fine when only its extrude is missing the regions to extrude, as when it was emptied.
              step.kind === 'sketch' && !(part && own === missingRegionProblem(part)) && own !== kVariableMissing
              ? own
              : null;
    // A Remove whose depth comes to nothing, as a variable can set it, fails as the reference says; its part is kept.
    const nothing =
      step.kind === 'extrude' && part?.remove && part.remove.depth === 0 && !step.suppressed
        ? 'Failed to extrude selections, check input.'
        : null;
    const reason = lost ?? regions ?? nothing ?? onFace;
    // A Cut parts step whose typed values can't be followed keeps its last good ones, and says why on its row.
    const values = step.kind === 'partCut' ? partCutProblems.get(step.id) : undefined;
    // A Fillet step that can't round some of its corners leaves them sharp, and says so on its row. A part that's
    // switched off, itself or by its folder, isn't made, so neither is its fillet.
    const sharp =
      step.kind === 'fillet' && part && !step.suppressed && !part.suppressed && !masked.has(part.id)
        ? // A part that can't be built has nothing to round. Rounds that run into each other say so, as the reference does.
          (() => {
            const problems = filletProblems(document, part).filter(problem => problem.filletId === step.id);
            if (!own && !problems.length) return undefined;
            return problems.some(problem => /overlap/.test(problem.message)) ? 'Overlapping fillets.' : 'Failed to fillet selections.';
          })()
        : undefined;
    // An Extrude › Intersect that keeps nothing says so on its row.
    if (step.kind === 'extrude' && part?.intersect && !step.suppressed) {
      const made = mergedWithAll(document, part)?.made;
      if (made && 'refused' in made) return { ...step, broken: made.refused };
    }
    // A Mirror › Add that can't join the part with its mirror image leaves the part as it was.
    const unmirrored =
      step.kind === 'mirror' && part && !step.suppressed
        ? evaluateCadPart(part).diagnostics.find(d => d.code === 'mirror-unresolved' && d.entityIds?.includes(step.id))?.message
        : undefined;
    if (unmirrored) return { ...step, broken: unmirrored };
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
  // A part naming a variable that's gone can't be built, and what's built on it fails in turn.
  const naming = cadPartsMissingVariables(document);
  const broken = new Map<string, string>([...naming].map(id => [id, kVariableMissing]));
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
      // What it's built on being gone comes first, even for a part that names a missing variable itself.
      if (broken.has(part.id) && !naming.has(part.id)) continue;
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
        naming.delete(part.id);
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
        detail: step.operation ?? `clearance ${typed(step.clearanceExpression, step.clearance, document.lengthUnit)}`,
        partId: owner?.id ?? reference,
        ...(owner && reference !== owner.id && { copyId: reference.slice(owner.id.length + 1) }),
        partCutId: step.id,
        suppressed: !!step.suppressed,
      },
    ]);
  }
  const byId = new Map(document.parts.map(part => [part.id, part]));
  const madeWith = (part: CadPart) => !!part.extrudedWith && !!byId.get(part.extrudedWith) && !byId.get(part.extrudedWith)!.extrudedWith;
  return numberedSteps(
    document,
    filletsAfterTheirCuts(
      document,
      document.parts.flatMap((part, partIndex) => {
        // A piece a through cut split off a part is a part, not a step of the design.
        if (part.pieceOf) return [];
        const steps: DesignStep[] = [
          // A part extruding another's sketch has none of its own, nor has a copy taken out of its pattern to be split.
          ...(part.sketchOf || part.faceProfile || part.split?.fromCopy
            ? []
            : [{ id: `${part.id}:sketch`, kind: 'sketch' as const, label: sketchStepLabel(part), partId: part.id }]),
          // A sketch not yet extruded is only its sketch, and a part made by another's extrude is listed in that one.
          ...(part.extrude === false || madeWith(part) || part.split?.fromCopy
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
        for (const join of part.mirrorJoins ?? [])
          steps.push({ id: join.id, kind: 'mirror', label: `Mirror · ${part.name}`, partId: part.id, suppressed: !!join.suppressed });
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
            // A Remove's pattern repeats its cuts: a feature pattern, numbered among them.
            label:
              part.remove && !part.pattern.circular
                ? `Linear pattern ${document.parts.filter(other => other.remove && other.pattern && !other.pattern.circular).indexOf(part) + 1}`
                : part.pattern.circular
                  ? // Numbered among the circular patterns, as the reference numbers features.
                    `Circular pattern ${document.parts.filter(other => other.pattern?.circular).indexOf(part) + 1}`
                  : `Pattern · ${part.name} × ${part.pattern.count} along ${part.pattern.axis}`,
            detail: part.pattern.circular
              ? `angle ${part.pattern.circular.angleExpression ? `${part.pattern.circular.angleExpression} = ` : ''}${+part.pattern.circular.angle.toFixed(3)}°`
              : `spacing ${typed(part.pattern.spacingExpression, part.pattern.spacing, document.lengthUnit)}`,
            partId: part.id,
            suppressed: !!part.pattern.suppressed,
          });
        // A Split, numbered among them as the reference numbers features.
        if (part.split)
          steps.push({
            id: part.split.id,
            kind: 'split',
            label: `Split ${document.parts.filter(other => other.split).indexOf(part) + 1}`,
            partId: part.id,
            suppressed: !!part.split.suppressed,
          });
        return [...steps, ...(after.get(partIndex) ?? [])];
      })
    )
  );
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

/**
 * A Fillet that rounds the edges of cuts later steps made, as a cup's rim made by Extrude › Remove, comes after those
 * steps, where it was made: the steps are listed part by part otherwise, and its part's come first.
 */
function filletsAfterTheirCuts(document: CadDocument, steps: DesignStep[]): DesignStep[] {
  const fillets = new Map(document.parts.flatMap(part => (part.fillets ?? []).map(fillet => [fillet.id, { part, fillet }] as const)));
  let ordered = steps;
  for (const step of steps) {
    if (step.kind !== 'fillet') continue;
    const found = fillets.get(step.id);
    if (!found) continue;
    const cuts = new Map(cadCuts(found.part).map(cut => [cut.id, cut.removedBy]));
    // A cut's id names the Remove that makes it, so the order holds while that Remove cuts nothing, as at no depth.
    const after = new Set(
      (found.fillet.rims ?? []).flatMap(rim =>
        rim.loops.flatMap(loop => {
          const by = cuts.get(loop) ?? (loop.includes(':cut:') ? loop.split(':cut:')[0] : undefined);
          return by ? [`${by}:extrude`] : [];
        })
      )
    );
    if (!after.size) continue;
    const last = Math.max(...ordered.flatMap((candidate, index) => (after.has(candidate.id) ? [index] : [])));
    const at = ordered.indexOf(step);
    if (last < 0 || last < at) continue;
    ordered = [...ordered.slice(0, at), ...ordered.slice(at + 1, last + 1), step, ...ordered.slice(last + 1)];
  }
  return ordered;
}
