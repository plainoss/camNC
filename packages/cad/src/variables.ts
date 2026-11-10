import { resolveDatumPlanes } from './datumPlanes';
import { dimensionValueError } from './dimensionValues';
import { newCadId } from './document';
import type {
  CadConstraint,
  CadCut,
  CadDiagnostic,
  CadDocument,
  CadLinearPattern,
  CadPartCut,
  CadPart,
  CadPlacement,
  CadTurn,
  CadSketch,
  CadVariable,
} from './types';
import {
  cadExpressionNames,
  cadVariableNameError,
  parseCadValue,
  renameCadExpressionVariable,
  type CadValueScope,
  type CadVariableKind,
} from './valueExpressions';

export const CAD_MIN_THICKNESS = 0.1;
export interface CadVariableValue {
  value: number;
  kind: CadVariableKind;
}
type Outcome = { value: number } | { error: string };

/** A plain number makes a number variable, and a length or angle unit makes that kind. */
function evaluateVariable(expression: string, scope: CadValueScope): CadVariableValue | { error: string } {
  const attempts = (['number', 'length', 'angle'] as const).map(kind => ({
    kind,
    result: parseCadValue(expression, { unit: kind === 'number' ? 'scalar' : kind === 'length' ? 'mm' : 'deg', variables: scope }),
  }));
  const found = attempts.find(attempt => 'value' in attempt.result);
  if (found && 'value' in found.result) return { value: found.result.value, kind: found.kind };
  return attempts[1]!.result as { error: string };
}

/** Every variable's value, and why any of them can't be worked out, by variable ID. */
export function cadVariableValues(document: CadDocument): { scope: Record<string, CadVariableValue>; errors: Record<string, string> } {
  const variables = document.variables ?? [];
  const byName = new Map(variables.map(variable => [variable.name, variable]));
  const scope: Record<string, CadVariableValue> = {},
    errors: Record<string, string> = {},
    visiting = new Set<string>();
  const visit = (variable: CadVariable): boolean => {
    if (Object.hasOwn(scope, variable.name)) return true;
    if (errors[variable.id]) return false;
    if (visiting.has(variable.name)) {
      errors[variable.id] = `${variable.name} refers back to itself.`;
      return false;
    }
    visiting.add(variable.name);
    const local: Record<string, CadVariableValue> = {};
    for (const name of cadExpressionNames(variable.expression)) {
      const used = byName.get(name);
      if (!used) continue;
      if (visit(used)) local[name] = scope[name]!;
      else errors[variable.id] ??= `Fix ${name} first.`;
    }
    visiting.delete(variable.name);
    if (errors[variable.id]) return false;
    const result = evaluateVariable(variable.expression, local);
    if ('error' in result) {
      errors[variable.id] = result.error;
      return false;
    }
    scope[variable.name] = result;
    return true;
  };
  variables.forEach(visit);
  return { scope, errors };
}

export const cadVariableScope = (document: CadDocument): CadValueScope => cadVariableValues(document).scope;

const usesVariables = (expression: string | undefined): expression is string => !!expression && cadExpressionNames(expression).length > 0;

const kPatternCounts = ['countX', 'countY'] as const,
  kPatternSpacings = [
    ['spacingX', 'stepX'],
    ['spacingY', 'stepY'],
  ] as const;

/** A linear pattern with its typed counts and spacings worked out, or why they can't be. */
function patternOutcome(
  constraint: CadConstraint,
  scope: CadValueScope
): { pattern: CadLinearPattern } | { error: string; expression: string } | null {
  if (constraint.type !== 'linearPattern' || !constraint.expressions) return null;
  const typed = constraint.expressions;
  if (!Object.values(typed).some(expression => usesVariables(expression))) return null;
  const pattern = { ...constraint };
  for (const key of kPatternCounts) {
    const expression = typed[key];
    if (!usesVariables(expression)) continue;
    const parsed = parseCadValue(expression, { unit: 'scalar', variables: scope });
    if ('error' in parsed) return { error: parsed.error, expression };
    // A count says how many fit, so a part-way result rounds down.
    pattern[key] = Math.floor(parsed.value + 1e-9);
    if (pattern[key] < 1) return { error: 'That leaves no room for even one.', expression };
  }
  for (const [key, step] of kPatternSpacings) {
    const expression = typed[key];
    if (!usesVariables(expression)) continue;
    const parsed = parseCadValue(expression, { unit: 'mm', variables: scope });
    if ('error' in parsed) return { error: parsed.error, expression };
    const length = Math.hypot(pattern[step].x, pattern[step].y);
    if (parsed.value <= 0 || length === 0) return { error: 'A pattern’s spacing needs to be more than nothing.', expression };
    pattern[step] = { x: (pattern[step].x / length) * parsed.value, y: (pattern[step].y / length) * parsed.value };
  }
  const total = pattern.countX * pattern.countY;
  if (total < 2 || total > 200)
    return { error: 'A pattern needs two to 200 copies, counting the first.', expression: typed.countX ?? typed.countY ?? '' };
  return { pattern };
}

function dimensionOutcome(constraint: CadConstraint, scope: CadValueScope): Outcome | null {
  if (!('value' in constraint) || constraint.driven || !usesVariables(constraint.expression)) return null;
  const parsed = parseCadValue(constraint.expression, { unit: constraint.type === 'angle' ? 'deg' : 'mm', variables: scope });
  if ('error' in parsed) return parsed;
  const problem = dimensionValueError(constraint, parsed.value);
  if (problem) return { error: problem };
  // A line's own width or height going negative would flip it over, which no change of size means.
  if (
    (constraint.type === 'distanceX' || constraint.type === 'distanceY') &&
    constraint.sourceEntityId !== undefined &&
    parsed.value * constraint.value < 0
  )
    return { error: 'That would flip this line over. It needs to stay above zero.' };
  return { value: parsed.value };
}

function clearanceOutcome(step: CadPartCut, scope: CadValueScope): Outcome | null {
  if (!usesVariables(step.clearanceExpression)) return null;
  const parsed = parseCadValue(step.clearanceExpression, { unit: 'mm', variables: scope });
  if ('error' in parsed) return parsed;
  return parsed.value >= 0 ? parsed : { error: 'A clearance can’t be less than nothing.' };
}

function fingersOutcome(step: CadPartCut, scope: CadValueScope): Outcome | null {
  if (typeof step.split !== 'object' || !usesVariables(step.split.fingersExpression)) return null;
  const parsed = parseCadValue(step.split.fingersExpression, { unit: 'scalar', variables: scope });
  if ('error' in parsed) return parsed;
  return Number.isInteger(parsed.value) && parsed.value >= 2
    ? parsed
    : { error: 'A finger joint needs a whole number of fingers, at least 2.' };
}

/** A part pattern with its typed count, spacing and angle worked out, or why one can't be. */
function partPatternOutcome(
  part: CadPart,
  scope: CadValueScope
):
  | { count: number; spacing: number; circular?: NonNullable<CadPart['pattern']>['circular'] }
  | { error: string; expression: string }
  | null {
  const pattern = part.pattern;
  if (
    !pattern ||
    (!usesVariables(pattern.countExpression) &&
      !usesVariables(pattern.spacingExpression) &&
      !usesVariables(pattern.circular?.angleExpression))
  )
    return null;
  let { count, spacing, circular } = pattern;
  if (usesVariables(pattern.countExpression)) {
    const parsed = parseCadValue(pattern.countExpression, { unit: 'scalar', variables: scope });
    if ('error' in parsed) return { error: parsed.error, expression: pattern.countExpression };
    // A count says how many fit, so a part-way result rounds down.
    count = Math.floor(parsed.value + 1e-9);
    if (count < 1 || count > 200)
      return { error: 'A part pattern makes one to 200, counting the part itself.', expression: pattern.countExpression };
  }
  if (!circular && usesVariables(pattern.spacingExpression)) {
    const parsed = parseCadValue(pattern.spacingExpression, { unit: 'mm', variables: scope });
    if ('error' in parsed) return { error: parsed.error, expression: pattern.spacingExpression };
    spacing = parsed.value;
  }
  if (circular && usesVariables(circular.angleExpression)) {
    const parsed = parseCadValue(circular.angleExpression, { unit: 'deg', variables: scope });
    if ('error' in parsed) return { error: parsed.error, expression: circular.angleExpression };
    circular = parsed.value === circular.angle ? circular : { ...circular, angle: parsed.value };
  }
  return { count, spacing, ...(circular && { circular }) };
}

function reliefOutcome(part: CadPart, scope: CadValueScope): Outcome | null {
  const expression = part.cornerRelief?.diameterExpression;
  if (!usesVariables(expression)) return null;
  const parsed = parseCadValue(expression, { unit: 'mm', variables: scope });
  if ('error' in parsed) return parsed;
  return parsed.value > 0 ? parsed : { error: 'A bit needs to be wider than nothing.' };
}

function offsetOutcome(part: CadPart, scope: CadValueScope): Outcome | null {
  const expression = part.drawnOn?.offsetExpression;
  if (!usesVariables(expression)) return null;
  const parsed = parseCadValue(expression, { unit: 'mm', variables: scope });
  return 'error' in parsed ? parsed : { value: parsed.value };
}

function thinDepthOutcome(part: CadPart, scope: CadValueScope): Outcome | null {
  if (!part.thin || !usesVariables(part.thin.depthExpression)) return null;
  const parsed = parseCadValue(part.thin.depthExpression, { unit: 'mm', variables: scope });
  if ('error' in parsed) return parsed;
  return parsed.value > 0 ? parsed : { error: 'A thin board needs some depth.' };
}

function thicknessOutcome(part: CadPart, scope: CadValueScope): Outcome | null {
  if (!usesVariables(part.thicknessExpression)) return null;
  const parsed = parseCadValue(part.thicknessExpression, { unit: 'mm', variables: scope });
  if ('error' in parsed) return parsed;
  return parsed.value >= CAD_MIN_THICKNESS ? parsed : { error: `Thickness must be at least ${CAD_MIN_THICKNESS} mm.` };
}

const kAxes = ['x', 'y', 'z'] as const;

/** Each position axis that uses a variable, worked out. */
function positionOutcomes(
  placement: CadPlacement | undefined,
  scope: CadValueScope
): ({ axis: 'x' | 'y' | 'z'; expression: string } & Outcome)[] {
  return (placement?.positionExpressions ?? []).flatMap((expression, index) => {
    if (!usesVariables(expression ?? undefined)) return [];
    const parsed = parseCadValue(expression!, { unit: 'mm', variables: scope });
    return [{ axis: kAxes[index]!, expression: expression!, ...('error' in parsed ? { error: parsed.error } : { value: parsed.value }) }];
  });
}

/** The placement moved to where its typed positions say, or the same object when they agree already. */
function followPlacement(placement: CadPlacement | undefined, scope: CadValueScope): CadPlacement | undefined {
  const moves = positionOutcomes(placement, scope);
  if (!moves.some(move => 'value' in move && move.value !== placement!.position[kAxes.indexOf(move.axis)])) return placement;
  const position = [...placement!.position] as [number, number, number];
  for (const move of moves) if ('value' in move) position[kAxes.indexOf(move.axis)] = move.value;
  return { ...placement!, position };
}

/** The part's own placement and each copy's, passed through `edit`, keeping objects that didn't change. */
function mapPlacements(part: CadPart, edit: (placement: CadPlacement | undefined) => CadPlacement | undefined): CadPart {
  const placement = edit(part.placement);
  const copies = part.copies?.map(copy => {
    const moved = edit(copy.placement),
      offset = edit(copy.offset);
    return moved === copy.placement && offset === copy.offset
      ? copy
      : { ...copy, ...(moved !== copy.placement && { placement: moved }), ...(offset !== copy.offset && { offset }) };
  });
  const copiesChanged = copies?.some((copy, index) => copy !== part.copies![index]);
  // A move by X, Y and Z follows variables as a placement does.
  let moved = part.moved;
  if (moved && 'by' in moved) {
    const asPlacement: CadPlacement = {
      position: moved.by,
      rotation: [0, 0, 0, 1],
      ...(moved.byExpressions && { positionExpressions: moved.byExpressions }),
    };
    const edited = edit(asPlacement);
    if (edited && edited !== asPlacement)
      moved = {
        by: edited.position,
        ...(edited.positionExpressions && { byExpressions: edited.positionExpressions }),
        // A turned move stays turned.
        ...(moved.turn && { turn: moved.turn }),
      };
  }
  if (placement === part.placement && !copiesChanged && moved === part.moved) return part;
  return {
    ...part,
    ...(placement !== part.placement && { placement }),
    ...(copiesChanged && { copies }),
    ...(moved !== part.moved && { moved }),
  };
}

/** The part's turned move and turned copies, each turn passed through `edit`, keeping objects that didn't change. */
function mapTurns(part: CadPart, edit: (turn: CadTurn) => CadTurn): CadPart {
  const moveTurn = part.moved && 'by' in part.moved ? part.moved.turn : undefined;
  const turned = moveTurn && edit(moveTurn);
  const copies = part.copies?.map(copy => {
    const turn = copy.turn && edit(copy.turn);
    return turn === copy.turn ? copy : { ...copy, turn };
  });
  const copiesChanged = copies?.some((copy, index) => copy !== part.copies![index]);
  if (turned === moveTurn && !copiesChanged) return part;
  return { ...part, ...(turned !== moveTurn && { moved: { ...part.moved!, turn: turned } }), ...(copiesChanged && { copies }) };
}

/** A turn's angle as its variables now say, or the same turn. */
function followTurn(turn: CadTurn, scope: CadValueScope): CadTurn {
  if (!usesVariables(turn.degreesExpression)) return turn;
  const parsed = parseCadValue(turn.degreesExpression!, { unit: 'deg', variables: scope });
  return 'error' in parsed || parsed.value === turn.degrees ? turn : { ...turn, degrees: parsed.value };
}

function copyDistanceOutcome(expression: string | undefined, scope: CadValueScope): Outcome | null {
  return usesVariables(expression) ? parseCadValue(expression!, { unit: 'mm', variables: scope }) : null;
}

function depthOutcome(cut: Pick<CadCut, 'depthExpression'>, scope: CadValueScope): Outcome | null {
  if (!usesVariables(cut.depthExpression)) return null;
  const parsed = parseCadValue(cut.depthExpression, { unit: 'mm', variables: scope });
  if ('error' in parsed) return parsed;
  if (parsed.value < 0) return { error: 'A cut can’t be less than nothing deep.' };
  return parsed.value === 0 ? { error: 'A cut needs some depth.' } : parsed;
}

/** The part with each cut passed through `edit`, keeping objects that didn't change. */
function mapCuts(part: CadPart, edit: (cut: CadCut) => CadCut): CadPart {
  if (!part.features?.some(feature => feature.type === 'cut')) return part;
  const features = part.features.map(feature => (feature.type === 'cut' ? edit(feature) : feature));
  return features.every((feature, index) => feature === part.features![index]) ? part : { ...part, features };
}

/** The part with each of its sketches passed through `edit`, keeping objects that didn't change. */
function mapSketches(part: CadPart, edit: (sketch: CadSketch) => CadSketch): CadPart {
  const sketch = edit(part.sketch);
  let features = part.features;
  if (features?.some(feature => feature.type === 'sketch')) {
    const next = features.map(feature => (feature.type === 'sketch' ? { ...feature, sketch: edit(feature.sketch) } : feature));
    if (next.some((feature, index) => feature.type === 'sketch' && feature.sketch !== (features![index] as typeof feature).sketch))
      features = next;
  }
  return sketch === part.sketch && features === part.features ? part : { ...part, sketch, features };
}

function mapConstraints(sketch: CadSketch, edit: (constraint: CadConstraint) => CadConstraint): CadSketch {
  const constraints = sketch.constraints.map(edit);
  return constraints.every((constraint, index) => constraint === sketch.constraints[index]) ? sketch : { ...sketch, constraints };
}

/**
 * Brings every value that uses a variable up to date. One that can't be worked out keeps its last good value, so its
 * part keeps its last good shape, and `cadVariableProblems` says why.
 */
export function applyCadVariables(document: CadDocument): CadDocument {
  if (!document.variables?.length) return document;
  const { scope } = cadVariableValues(document);
  const parts = document.parts.map(part => {
    const thickness = thicknessOutcome(part, scope);
    let sized = thickness && 'value' in thickness && thickness.value !== part.thickness ? { ...part, thickness: thickness.value } : part;
    sized = mapPlacements(sized, placement => followPlacement(placement, scope));
    sized = mapTurns(sized, turn => followTurn(turn, scope));
    const copies = sized.copies?.map(copy => {
      const outcome = copyDistanceOutcome(copy.along?.distanceExpression, scope);
      return outcome && 'value' in outcome && outcome.value !== copy.along!.distance
        ? { ...copy, along: { ...copy.along!, distance: outcome.value } }
        : copy;
    });
    if (copies?.some((copy, index) => copy !== sized.copies![index])) sized = { ...sized, copies };
    const offset = offsetOutcome(sized, scope);
    if (offset && 'value' in offset && offset.value !== sized.drawnOn!.offset)
      sized = { ...sized, drawnOn: { ...sized.drawnOn!, offset: offset.value } };
    const depth = thinDepthOutcome(sized, scope);
    if (depth && 'value' in depth && depth.value !== sized.thin!.depth) sized = { ...sized, thin: { ...sized.thin!, depth: depth.value } };
    const relief = reliefOutcome(sized, scope);
    if (relief && 'value' in relief && relief.value !== sized.cornerRelief!.diameter)
      sized = { ...sized, cornerRelief: { ...sized.cornerRelief!, diameter: relief.value } };
    const pattern = partPatternOutcome(sized, scope);
    if (
      pattern &&
      'count' in pattern &&
      (pattern.count !== sized.pattern!.count || pattern.spacing !== sized.pattern!.spacing || pattern.circular !== sized.pattern!.circular)
    )
      sized = { ...sized, pattern: { ...sized.pattern!, ...pattern } };
    const removal = sized.remove && depthOutcome(sized.remove, scope);
    if (removal && 'value' in removal && removal.value !== sized.remove!.depth)
      sized = { ...sized, remove: { ...sized.remove!, depth: removal.value } };
    // Fillet radii follow their variables; one that can't be worked out keeps its last good radius.
    const radii = sized.fillets?.map(fillet => {
      if (!usesVariables(fillet.radiusExpression)) return fillet;
      const parsed = parseCadValue(fillet.radiusExpression, { unit: 'mm', variables: scope });
      return 'value' in parsed && parsed.value > 0 && parsed.value !== fillet.radius ? { ...fillet, radius: parsed.value } : fillet;
    });
    if (radii?.some((fillet, index) => fillet !== sized.fillets![index])) sized = { ...sized, fillets: radii };
    // A Hole step's diameter follows its variables too; one that can't be worked out keeps its last good size.
    const hole =
      sized.hole &&
      usesVariables(sized.hole.diameterExpression) &&
      parseCadValue(sized.hole.diameterExpression, { unit: 'mm', variables: scope });
    if (hole && 'value' in hole && hole.value > 0 && hole.value !== sized.hole!.diameter)
      sized = { ...sized, hole: { ...sized.hole!, diameter: hole.value } };
    sized = mapCuts(sized, cut => {
      const outcome = depthOutcome(cut, scope);
      return outcome && 'value' in outcome && outcome.value !== cut.depth ? { ...cut, depth: outcome.value } : cut;
    });
    return mapSketches(sized, sketch =>
      mapConstraints(sketch, constraint => {
        const following = patternOutcome(constraint, scope);
        if (following && 'pattern' in following)
          return JSON.stringify(following.pattern) === JSON.stringify(constraint) ? constraint : following.pattern;
        const outcome = dimensionOutcome(constraint, scope);
        return outcome && 'value' in outcome && outcome.value !== (constraint as { value: number }).value
          ? ({ ...constraint, value: outcome.value } as CadConstraint)
          : constraint;
      })
    );
  });
  const partCuts = document.partCuts?.map(step => {
    const outcome = clearanceOutcome(step, scope);
    let next = outcome && 'value' in outcome && outcome.value !== step.clearance ? { ...step, clearance: outcome.value } : step;
    const fingers = fingersOutcome(step, scope);
    if (typeof step.split === 'object' && fingers && 'value' in fingers && fingers.value !== step.split.fingers)
      next = { ...next, split: { ...step.split, fingers: fingers.value } };
    return next;
  });
  const cutsChanged = partCuts?.some((step, index) => step !== document.partCuts![index]);
  const planes = document.planes?.map(plane => {
    if (!usesVariables(plane.offsetExpression)) return plane;
    const parsed = parseCadValue(plane.offsetExpression, { unit: 'mm', variables: scope });
    return 'error' in parsed || parsed.value === plane.offset ? plane : { ...plane, offset: parsed.value };
  });
  const planesChanged = planes?.some((plane, index) => plane !== document.planes![index]);
  if (parts.every((part, index) => part === document.parts[index]) && !cutsChanged && !planesChanged) return document;
  const next = { ...document, parts, ...(cutsChanged && { partCuts }), ...(planesChanged && { planes }) };
  // What's drawn on a plane that moved goes with it.
  return planesChanged ? resolveDatumPlanes(next) : next;
}

/** Variables that can't be worked out, and values on parts that can't follow their variables. */
export function cadVariableProblems(document: CadDocument): CadDiagnostic[] {
  const { scope, errors } = cadVariableValues(document);
  const problems: CadDiagnostic[] = (document.variables ?? [])
    .filter(variable => errors[variable.id])
    .map(variable => ({ code: 'invalid-variable', severity: 'error', message: `${variable.name}: ${errors[variable.id]}` }));
  for (const part of document.parts) {
    const thickness = thicknessOutcome(part, scope);
    if (thickness && 'error' in thickness)
      problems.push({
        code: 'variable-value',
        severity: 'error',
        partId: part.id,
        message: `Thickness ${part.thicknessExpression}: ${thickness.error}`,
      });
    const depth = thinDepthOutcome(part, scope);
    if (depth && 'error' in depth)
      problems.push({
        code: 'variable-value',
        severity: 'error',
        partId: part.id,
        message: `Depth ${part.thin!.depthExpression}: ${depth.error}`,
      });
    const relief = reliefOutcome(part, scope);
    if (relief && 'error' in relief)
      problems.push({
        code: 'variable-value',
        severity: 'error',
        partId: part.id,
        message: `Corner relief ${part.cornerRelief!.diameterExpression}: ${relief.error}`,
      });
    for (const copy of part.copies ?? []) {
      const outcome = copyDistanceOutcome(copy.along?.distanceExpression, scope);
      if (outcome && 'error' in outcome)
        problems.push({
          code: 'variable-value',
          severity: 'error',
          partId: part.id,
          message: `Copy distance ${copy.along!.distanceExpression}: ${outcome.error}`,
        });
    }
    const pattern = partPatternOutcome(part, scope);
    if (pattern && 'error' in pattern)
      problems.push({
        code: 'variable-value',
        severity: 'error',
        partId: part.id,
        message: `Part pattern ${pattern.expression}: ${pattern.error}`,
      });
    const offset = offsetOutcome(part, scope);
    if (offset && 'error' in offset)
      problems.push({
        code: 'variable-value',
        severity: 'error',
        partId: part.id,
        message: `Offset ${part.drawnOn!.offsetExpression}: ${offset.error}`,
      });
    for (const feature of part.features ?? []) {
      const outcome = feature.type === 'cut' ? depthOutcome(feature, scope) : null;
      if (outcome && 'error' in outcome)
        problems.push({
          code: 'variable-value',
          severity: 'error',
          partId: part.id,
          message: `Cut depth ${(feature as CadCut).depthExpression}: ${outcome.error}`,
        });
    }
    for (const move of [part.placement, ...(part.copies ?? []).flatMap(copy => [copy.placement, copy.offset])].flatMap(placement =>
      positionOutcomes(placement, scope)
    ))
      if ('error' in move)
        problems.push({
          code: 'variable-value',
          severity: 'error',
          partId: part.id,
          message: `Position ${move.axis} ${move.expression}: ${move.error}`,
        });
    for (const sketch of [part.sketch, ...(part.features ?? []).flatMap(feature => (feature.type === 'sketch' ? [feature.sketch] : []))])
      for (const constraint of sketch.constraints) {
        const following = patternOutcome(constraint, scope);
        if (following && 'error' in following)
          problems.push({
            code: 'variable-value',
            severity: 'error',
            partId: part.id,
            constraintIds: [constraint.id],
            message: `Pattern ${following.expression}: ${following.error}`,
          });
        const outcome = dimensionOutcome(constraint, scope);
        if (outcome && 'error' in outcome)
          problems.push({
            code: 'variable-value',
            severity: 'error',
            partId: part.id,
            constraintIds: [constraint.id],
            message: `${(constraint as { expression: string }).expression}: ${outcome.error}`,
          });
      }
  }
  for (const step of document.partCuts ?? []) {
    const outcome = clearanceOutcome(step, scope);
    if (outcome && 'error' in outcome)
      problems.push({
        code: 'variable-value',
        severity: 'error',
        message: `Cut parts clearance ${step.clearanceExpression}: ${outcome.error}`,
      });
    const fingers = fingersOutcome(step, scope);
    if (fingers && 'error' in fingers && typeof step.split === 'object')
      problems.push({
        code: 'variable-value',
        severity: 'error',
        message: `Cut parts fingers ${step.split.fingersExpression}: ${fingers.error}`,
      });
  }
  return problems;
}

function withPlacementExpressions(part: CadPart, edit: (expression: string) => string): CadPart {
  return mapPlacements(part, placement =>
    placement?.positionExpressions
      ? {
          ...placement,
          positionExpressions: placement.positionExpressions.map(expression => (expression ? edit(expression) : expression)) as [
            string | null,
            string | null,
            string | null,
          ],
        }
      : placement
  );
}

/** Every expression in the document, rewritten by `edit`. */
function mapExpressions(document: CadDocument, edit: (expression: string) => string): CadDocument {
  return {
    ...document,
    variables: document.variables?.map(variable => ({ ...variable, expression: edit(variable.expression) })),
    planes: document.planes?.map(plane => (plane.offsetExpression ? { ...plane, offsetExpression: edit(plane.offsetExpression) } : plane)),
    partCuts: document.partCuts?.map(step => ({
      ...step,
      ...(step.clearanceExpression && { clearanceExpression: edit(step.clearanceExpression) }),
      ...(typeof step.split === 'object' &&
        step.split.fingersExpression && {
          split: { ...step.split, fingersExpression: edit(step.split.fingersExpression) },
        }),
    })),
    parts: document.parts.map(part =>
      mapSketches(
        mapCuts(
          withPlacementExpressions(
            mapTurns(
              {
                ...part,
                ...part,
                ...(part.thicknessExpression && { thicknessExpression: edit(part.thicknessExpression) }),
                ...(part.cornerRelief?.diameterExpression && {
                  cornerRelief: { ...part.cornerRelief, diameterExpression: edit(part.cornerRelief.diameterExpression) },
                }),
                ...(part.thin?.depthExpression && { thin: { ...part.thin, depthExpression: edit(part.thin.depthExpression) } }),
                ...(part.hole?.diameterExpression && { hole: { ...part.hole, diameterExpression: edit(part.hole.diameterExpression) } }),
                ...(part.fillets && {
                  fillets: part.fillets.map(fillet =>
                    fillet.radiusExpression ? { ...fillet, radiusExpression: edit(fillet.radiusExpression) } : fillet
                  ),
                }),
                ...(part.remove?.depthExpression && { remove: { ...part.remove, depthExpression: edit(part.remove.depthExpression) } }),
                ...(part.drawnOn?.offsetExpression && {
                  drawnOn: { ...part.drawnOn, offsetExpression: edit(part.drawnOn.offsetExpression) },
                }),
                ...(part.copies && {
                  copies: part.copies.map(copy =>
                    copy.along?.distanceExpression
                      ? { ...copy, along: { ...copy.along, distanceExpression: edit(copy.along.distanceExpression) } }
                      : copy
                  ),
                }),
                ...(part.pattern && {
                  pattern: {
                    ...part.pattern,
                    ...(part.pattern.countExpression && { countExpression: edit(part.pattern.countExpression) }),
                    ...(part.pattern.spacingExpression && { spacingExpression: edit(part.pattern.spacingExpression) }),
                    ...(part.pattern.circular?.angleExpression && {
                      circular: { ...part.pattern.circular, angleExpression: edit(part.pattern.circular.angleExpression) },
                    }),
                  },
                }),
              },
              turn => (turn.degreesExpression ? { ...turn, degreesExpression: edit(turn.degreesExpression) } : turn)
            ),
            edit
          ),
          cut => (cut.depthExpression ? { ...cut, depthExpression: edit(cut.depthExpression) } : cut)
        ),
        sketch =>
          mapConstraints(sketch, constraint =>
            'expression' in constraint && constraint.expression
              ? { ...constraint, expression: edit(constraint.expression) }
              : constraint.type === 'linearPattern' && constraint.expressions
                ? {
                    ...constraint,
                    expressions: Object.fromEntries(
                      Object.entries(constraint.expressions).map(([key, expression]) => [key, expression && edit(expression)])
                    ),
                  }
                : constraint
          )
      )
    ),
  };
}

/** How many expressions use a variable: other variables, thicknesses and dimensions. */
export function cadVariableUses(document: CadDocument, name: string): number {
  let uses = 0;
  mapExpressions(document, expression => {
    if (cadExpressionNames(expression).includes(name)) uses++;
    return expression;
  });
  return uses;
}

/**
 * Adds a variable, or changes one by ID, and brings everything that uses it up to date. A rename carries through to
 * every expression that uses the old name. Refused when it leaves any variable that can't be worked out.
 */
export function setCadVariable(
  document: CadDocument,
  change: { id?: string; name: string; expression: string; folderId?: string | null }
): { document: CadDocument; id: string } | { error: string } {
  const name = change.name.trim(),
    expression = change.expression.trim();
  const nameError = cadVariableNameError(name);
  if (nameError) return { error: nameError };
  if (!expression) return { error: 'Enter a value.' };
  const variables = document.variables ?? [];
  const existing = variables.find(variable => variable.id === change.id);
  const folderId = change.folderId === null ? undefined : (change.folderId ?? existing?.folderId);
  if (folderId !== undefined && !document.folders?.some(folder => folder.id === folderId))
    return { error: 'This folder no longer exists.' };
  if (variables.some(variable => variable.name === name && variable.id !== existing?.id))
    return { error: `There's already a variable called ${name}.` };
  if (existing && existing.name === name && existing.expression === expression && existing.folderId === folderId)
    return { document, id: existing.id };
  const id = existing?.id ?? change.id ?? newCadId();
  let next: CadDocument = {
    ...document,
    revision: document.revision + 1,
    variables: existing
      ? variables.map(variable => (variable.id === id ? { id, name, expression, ...(folderId && { folderId }) } : variable))
      : [...variables, { id, name, expression, ...(folderId && { folderId }) }],
  };
  if (existing && existing.name !== name) next = mapExpressions(next, text => renameCadExpressionVariable(text, existing.name, name));
  const { errors } = cadVariableValues(next);
  const broken = next.variables!.find(variable => errors[variable.id]);
  if (broken) return { error: broken.id === id ? errors[id]! : `${broken.name}: ${errors[broken.id]}` };
  return { document: applyCadVariables(next), id };
}

/** Removes a variable nothing uses. */
export function removeCadVariable(document: CadDocument, id: string): { document: CadDocument } | { error: string } {
  const variable = document.variables?.find(candidate => candidate.id === id);
  if (!variable) return { document };
  const uses = cadVariableUses(document, variable.name);
  if (uses) return { error: `${variable.name} is used in ${uses === 1 ? 'one place' : `${uses} places`}. Change those first.` };
  const variables = document.variables!.filter(candidate => candidate.id !== id);
  const next: CadDocument = { ...document, revision: document.revision + 1, variables };
  if (!variables.length) delete next.variables;
  return { document: next };
}
