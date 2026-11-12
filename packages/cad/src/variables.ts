import { resolveDatumPlanes } from './datumPlanes';
import { newCadId } from './document';
import { partCutVariableErrors } from './partCutVariables';
import {
  mapTypedExpressions,
  mapTypedValues,
  usesVariables,
  visitTypedValues,
  workOutTypedValue,
  type LinearPatternWithExpressions,
} from './typedValues';
import type { CadDiagnostic, CadDocument, CadLinearPattern, CadVariable } from './types';
import {
  cadExpressionNames,
  cadVariableNameError,
  parseCadValue,
  renameCadExpressionVariable,
  type CadValueScope,
  type CadVariableKind,
} from './valueExpressions';

export { CAD_MIN_THICKNESS } from './typedValues';
export interface CadVariableValue {
  value: number;
  kind: CadVariableKind;
}

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

const kPatternCounts = ['countX', 'countY'] as const,
  kPatternSpacings = [
    ['spacingX', 'stepX'],
    ['spacingY', 'stepY'],
  ] as const;

/** A sketch pattern with its typed counts and spacings worked out together, or why they can't be; null when none uses a variable. */
function linearPatternOutcome(
  constraint: LinearPatternWithExpressions,
  scope: CadValueScope
): { pattern: CadLinearPattern } | { error: string; expression: string } | null {
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

/**
 * Brings every value that uses a variable up to date. One that can't be worked out keeps its last good value, so its
 * part keeps its last good shape, and `cadVariableProblems` says why.
 */
export function applyCadVariables(document: CadDocument): CadDocument {
  if (!document.variables?.length) return document;
  const { scope } = cadVariableValues(document);
  const next = mapTypedValues(document, {
    value(typed, kind) {
      if (kind.driven || !usesVariables(typed.expression)) return typed;
      const outcome = workOutTypedValue(typed.expression, kind, scope);
      return 'value' in outcome ? { expression: typed.expression, value: outcome.value } : typed;
    },
    pattern(pattern) {
      const outcome = linearPatternOutcome(pattern, scope);
      return outcome && 'pattern' in outcome && JSON.stringify(outcome.pattern) !== JSON.stringify(pattern) ? outcome.pattern : pattern;
    },
  });
  // What's drawn on a plane that moved goes with it.
  return next.planes === document.planes ? next : resolveDatumPlanes(next);
}

/** Variables that can't be worked out, and values on parts that can't follow their variables. */
export function cadVariableProblems(document: CadDocument): CadDiagnostic[] {
  const { scope, errors } = cadVariableValues(document);
  const problems: CadDiagnostic[] = (document.variables ?? [])
    .filter(variable => errors[variable.id])
    .map(variable => ({ code: 'invalid-variable', severity: 'error', message: `${variable.name}: ${errors[variable.id]}` }));
  const problem = (owner: { partId?: string; constraintId?: string }, message: string) =>
    problems.push({
      code: 'variable-value',
      severity: 'error',
      ...(owner.partId && { partId: owner.partId }),
      ...(owner.constraintId && { constraintIds: [owner.constraintId] }),
      message,
    });
  visitTypedValues(document, {
    value(typed, kind, owner) {
      if (kind.driven || kind.quiet || !usesVariables(typed.expression)) return;
      const outcome = workOutTypedValue(typed.expression, kind, scope);
      if ('error' in outcome) problem(owner, `${kind.label ? `${kind.label} ` : ''}${typed.expression}: ${outcome.error}`);
    },
    pattern(pattern, owner) {
      const outcome = linearPatternOutcome(pattern, scope);
      if (outcome && 'error' in outcome) problem(owner, `Pattern ${outcome.expression}: ${outcome.error}`);
    },
  });
  // A variable in error is said once above, rather than again on every part whose joint uses it.
  const broken = new Set((document.variables ?? []).filter(variable => errors[variable.id]).map(variable => variable.name));
  const covered = (expression: string) => cadExpressionNames(expression).some(name => broken.has(name));
  // On each part the step joins, so its row shows why; a step whose parts are all gone still says so once.
  for (const { partIds, message } of partCutVariableErrors(document, scope, covered))
    for (const partId of partIds.length ? partIds : [undefined]) problem({ partId }, message);
  return problems;
}

/** Every expression in the document, the variables' own included, rewritten by `edit`. */
function mapExpressions(document: CadDocument, edit: (expression: string) => string): CadDocument {
  return mapTypedExpressions(
    { ...document, variables: document.variables?.map(variable => ({ ...variable, expression: edit(variable.expression) })) },
    expression => edit(expression)
  );
}

/** How many expressions use a variable: other variables' and every typed value's. */
export function cadVariableUses(document: CadDocument, name: string): number {
  const uses = (expression: string | undefined) => (expression && cadExpressionNames(expression).includes(name) ? 1 : 0);
  let count = (document.variables ?? []).reduce((sum, variable) => sum + uses(variable.expression), 0);
  visitTypedValues(document, {
    value: typed => void (count += uses(typed.expression)),
    pattern: pattern => void Object.values(pattern.expressions).forEach(expression => (count += uses(expression))),
  });
  return count;
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
