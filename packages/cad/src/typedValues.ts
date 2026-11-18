import { dimensionValueError } from './dimensionValues';
import type { CadConstraint, CadDimension, CadDocument, CadLinearPattern, CadPlacement, CadSketch, CadTurn } from './types';
import { cadExpressionNames, parseCadValue, type CadValueScope, type CadValueUnit } from './valueExpressions';

export const CAD_MIN_THICKNESS = 0.1;

/** A value as typed, beside the number it last worked out to. */
export interface TypedValue {
  expression: string;
  value: number;
}

/** What a typed value measures: how it's worked out, what it has to satisfy and how a problem with it reads. */
export interface TypedValueKind {
  /** Starts the problem that says it can't be worked out. A dimension has none, since its expression says which it is, and neither has a quiet value. */
  label?: string;
  unit: CadValueUnit;
  /** A count says how many fit, so a part-way result rounds down. */
  whole?: true;
  /** Why a value that was worked out isn't allowed, if it isn't. */
  check?: (value: number) => string | null;
  /**
   * Keeps its last good value without a problem of its own. A part's own move and turn, a removal, a hole, a fillet and
   * a plane say nothing; a Cut parts step says it on the parts it joins (`partCutVariableErrors`). A copy's ordered
   * move and turn are not quiet: they say their own.
   */
  quiet?: true;
  /** A driven dimension shows what it measures, so its expression is kept and never worked out. */
  driven?: true;
}

/** Where a typed value sits, for the problem that names it. */
export interface TypedValueOwner {
  partId?: string;
  constraintId?: string;
  /** The ordered move or turn of a copy that holds it. */
  operationId?: string;
}

export type LinearPatternWithExpressions = CadLinearPattern & { expressions: NonNullable<CadLinearPattern['expressions']> };

export interface TypedValueEdit {
  /** One typed value; returns it, or what it becomes. */
  value(typed: TypedValue, kind: TypedValueKind, owner: TypedValueOwner): TypedValue;
  /** A sketch pattern's counts and spacings are worked out together (`linearPatternOutcome`), so it's passed whole. */
  pattern(pattern: LinearPatternWithExpressions, owner: TypedValueOwner): CadLinearPattern;
}

export const usesVariables = (expression: string | undefined | null): expression is string =>
  !!expression && cadExpressionNames(expression).length > 0;

/** A typed value worked out, or why it can't be; `got` is a value that was worked out but isn't allowed. */
export function workOutTypedValue(
  expression: string,
  kind: TypedValueKind,
  scope: CadValueScope
): { value: number } | { error: string; got?: number } {
  const parsed = parseCadValue(expression, { unit: kind.unit, variables: scope });
  if ('error' in parsed) return parsed;
  const value = kind.whole ? Math.floor(parsed.value + 1e-9) : parsed.value;
  const error = kind.check?.(value);
  return error ? { error, got: value } : { value };
}

/** How a typed value that can't be worked out says so. */
export const typedValueProblem = (expression: string, kind: TypedValueKind, error: string) =>
  `${kind.label ? `${kind.label} ` : ''}${expression}: ${error}`;

const moreThanNothing = (message: string) => (value: number) => (value > 0 ? null : message);

const kThickness: TypedValueKind = {
  label: 'Thickness',
  unit: 'mm',
  check: value => (value >= CAD_MIN_THICKNESS ? null : `Thickness must be at least ${CAD_MIN_THICKNESS} mm.`),
};
const kThinDepth: TypedValueKind = { label: 'Depth', unit: 'mm', check: moreThanNothing('A thin board needs some depth.') };
const kCornerRelief: TypedValueKind = {
  label: 'Corner relief',
  unit: 'mm',
  check: moreThanNothing('A bit needs to be wider than nothing.'),
};
const kDrawnOnOffset: TypedValueKind = { label: 'Offset', unit: 'mm' };
const kCopyDistance: TypedValueKind = { label: 'Copy distance', unit: 'mm' };
const kPartPatternCount: TypedValueKind = {
  label: 'Part pattern',
  unit: 'scalar',
  whole: true,
  check: value => (value >= 1 && value <= 200 ? null : 'A part pattern makes one to 200, counting the part itself.'),
};
const kPartPatternSpacing: TypedValueKind = { label: 'Part pattern', unit: 'mm' };
const kPartPatternAngle: TypedValueKind = { label: 'Part pattern', unit: 'deg' };
const cutDepthError = (value: number) =>
  value < 0 ? 'A cut can’t be less than nothing deep.' : value === 0 ? 'A cut needs some depth.' : null;
const kCutDepth: TypedValueKind = { label: 'Cut depth', unit: 'mm', check: cutDepthError };
// A Remove's depth follows its variables to zero or below too: it then cuts nothing, and says so when it's zero.
const kRemoveDepth: TypedValueKind = { unit: 'mm', quiet: true };
const kHoleDiameter: TypedValueKind = {
  unit: 'mm',
  check: moreThanNothing('A hole needs to be wider than nothing.'),
  quiet: true,
};
const kFilletRadius: TypedValueKind = {
  unit: 'mm',
  check: moreThanNothing('A fillet needs some radius.'),
  quiet: true,
};
const kTurn: TypedValueKind = { unit: 'deg', quiet: true };
const kPlaneOffset: TypedValueKind = { unit: 'mm', quiet: true };
const kAxes = ['x', 'y', 'z'] as const;
type AxisKinds = readonly [TypedValueKind, TypedValueKind, TypedValueKind];
const perAxis = (kind: (axis: (typeof kAxes)[number]) => TypedValueKind): AxisKinds => [kind('x'), kind('y'), kind('z')];
const kPosition = perAxis(axis => ({ label: `Position ${axis}`, unit: 'mm' }));
const kMoveBy = perAxis(() => ({ unit: 'mm', quiet: true }));
export const kCopyTranslation: TypedValueKind = { label: 'Translation', unit: 'mm' };
export const kCopyRotation: TypedValueKind = { label: 'Rotation', unit: 'deg' };
const kCopyTranslations = perAxis(() => kCopyTranslation);
export const kPartCutClearance: TypedValueKind = {
  label: 'Clearance',
  unit: 'mm',
  check: value => (value >= 0 ? null : 'a clearance can’t be less than nothing.'),
  quiet: true,
};
export const kPartCutCornerRelief: TypedValueKind = {
  label: 'Cutter diameter',
  unit: 'mm',
  check: value => (value > 0 ? null : 'a cutter diameter must be greater than zero.'),
  quiet: true,
};
export const kPartCutFingers: TypedValueKind = {
  label: 'Finger count',
  unit: 'scalar',
  check: value => (Number.isInteger(value) && value >= 2 ? null : 'a finger joint needs a whole number of fingers, at least 2.'),
  quiet: true,
};

function dimensionKind(dimension: CadDimension): TypedValueKind {
  const unit = dimension.type === 'angle' ? 'deg' : 'mm';
  if (dimension.driven) return { unit, driven: true };
  return {
    unit,
    check: value =>
      dimensionValueError(dimension, value) ??
      // A line's own width or height going negative would flip it over, which no change of size means.
      ((dimension.type === 'distanceX' || dimension.type === 'distanceY') &&
      dimension.sourceEntityId !== undefined &&
      value * dimension.value < 0
        ? 'That would flip this line over. It needs to stay above zero.'
        : null),
  };
}

/** `list` with each item passed through `edit`, or the same list when none changed. */
function each<T>(list: T[], edit: (item: T) => T): T[] {
  const next = list.map(item => edit(item));
  return next.every((item, index) => item === list[index]) ? list : next;
}

/** `owner` with what it holds under `key` passed through `edit`, or the same owner when that's missing or didn't change. */
function within<T, K extends keyof T>(owner: T, key: K, edit: (held: NonNullable<T[K]>) => T[K]): T {
  const held = owner[key];
  if (held === undefined || held === null) return owner;
  const next = edit(held);
  return next === held ? owner : { ...owner, [key]: next };
}

type Triple<T> = [T, T, T];

/**
 * Every value in the document that's kept as typed, passed through `edit`: the one place that knows where they are.
 * Objects that hold no change stay the same objects, so a document nothing changed in comes back as it was.
 */
export function mapTypedValues(document: CadDocument, edit: TypedValueEdit): CadDocument {
  let owner: TypedValueOwner = {};
  /** `holder[key]`, typed as `holder[key + 'Expression']`. A through cut has no depth to type. */
  const typed = <K extends string, T extends { [P in K]: number | 'through' } & { [P in `${K}Expression`]?: string }>(
    holder: T,
    key: K,
    kind: TypedValueKind
  ): T => {
    const expressionKey: `${K}Expression` = `${key}Expression`;
    // The constraint on T says so; the compiler can't follow it through the key it builds.
    const expression = holder[expressionKey] as string | undefined,
      value: number | 'through' = holder[key];
    if (!expression || typeof value !== 'number') return holder;
    const next = edit.value({ expression, value }, kind, owner);
    return next.expression === expression && next.value === value
      ? holder
      : { ...holder, [key]: next.value, [expressionKey]: next.expression };
  };
  /** Three numbers, each typed on its own or not at all. */
  const axes = (
    values: Triple<number>,
    expressions: Triple<string | null> | undefined,
    kinds: AxisKinds
  ): [Triple<number>, Triple<string | null> | undefined] => {
    if (!expressions) return [values, expressions];
    const nextValues: Triple<number> = [...values],
      nextExpressions: Triple<string | null> = [...expressions];
    let changed = false;
    kAxes.forEach((_, index) => {
      const expression = expressions[index];
      if (!expression) return;
      const next = edit.value({ expression, value: values[index]! }, kinds[index]!, owner);
      if (next.expression === expression && next.value === values[index]) return;
      nextValues[index] = next.value;
      nextExpressions[index] = next.expression;
      changed = true;
    });
    return changed ? [nextValues, nextExpressions] : [values, expressions];
  };
  const placed = (placement: CadPlacement): CadPlacement => {
    const [position, positionExpressions] = axes(placement.position, placement.positionExpressions, kPosition);
    return position === placement.position ? placement : { ...placement, position, positionExpressions };
  };
  const turned = (kind: TypedValueKind) => (turn: CadTurn) => typed(turn, 'degrees', kind);
  /** A distance along each axis and a turn, as a moved part and an ordered move of a copy both keep them. */
  const moved = <T extends { by: Triple<number>; byExpressions?: Triple<string | null>; turn?: CadTurn }>(
    move: T,
    byKinds: AxisKinds,
    turnKind: TypedValueKind
  ): T => {
    const [by, byExpressions] = axes(move.by, move.byExpressions, byKinds);
    return within(by === move.by ? move : { ...move, by, byExpressions }, 'turn', turned(turnKind));
  };
  const constrained = (constraint: CadConstraint): CadConstraint => {
    const at = owner;
    owner = { ...at, constraintId: constraint.id };
    let next = constraint;
    if (constraint.type === 'linearPattern') {
      if (constraint.expressions) next = edit.pattern(constraint as LinearPatternWithExpressions, owner);
    } else if ('value' in constraint && constraint.expression) {
      const typedValue = edit.value({ expression: constraint.expression, value: constraint.value }, dimensionKind(constraint), owner);
      if (typedValue.expression !== constraint.expression || typedValue.value !== constraint.value)
        next = { ...constraint, value: typedValue.value, expression: typedValue.expression };
    }
    owner = at;
    return next;
  };
  const sketched = (sketch: CadSketch) => within(sketch, 'constraints', constraints => each(constraints, constrained));

  const parts = each(document.parts, part => {
    owner = { partId: part.id };
    let next = typed(part, 'thickness', kThickness);
    next = within(next, 'thin', thin => typed(thin, 'depth', kThinDepth));
    next = within(next, 'cornerRelief', relief => typed(relief, 'diameter', kCornerRelief));
    next = within(next, 'pattern', pattern => {
      const counted = typed(pattern, 'count', kPartPatternCount);
      // Copies about a line are an angle apart; only copies in a row are a spacing apart.
      return counted.circular
        ? within(counted, 'circular', circular => typed(circular, 'angle', kPartPatternAngle))
        : typed(counted, 'spacing', kPartPatternSpacing);
    });
    next = within(next, 'drawnOn', drawnOn => typed(drawnOn, 'offset', kDrawnOnOffset));
    next = within(next, 'placement', placed);
    next = within(next, 'moved', move => ('by' in move ? moved(move, kMoveBy, kTurn) : move));
    next = within(next, 'copies', copies =>
      each(copies, copy => {
        let copied = within(copy, 'along', along => typed(along, 'distance', kCopyDistance));
        copied = within(copied, 'placement', placed);
        copied = within(copied, 'offset', placed);
        return within(copied, 'turn', turned(kTurn));
      })
    );
    next = within(next, 'remove', remove => typed(remove, 'depth', kRemoveDepth));
    next = within(next, 'hole', hole => typed(hole, 'diameter', kHoleDiameter));
    next = within(next, 'fillets', fillets => each(fillets, fillet => typed(fillet, 'radius', kFilletRadius)));
    next = within(next, 'sketch', sketched);
    return within(next, 'features', features =>
      each(features, feature => (feature.type === 'cut' ? typed(feature, 'depth', kCutDepth) : within(feature, 'sketch', sketched)))
    );
  });
  owner = {};
  const planes = document.planes && each(document.planes, plane => typed(plane, 'offset', kPlaneOffset));
  const partCuts =
    document.partCuts &&
    each(document.partCuts, step =>
      within(
        within(typed(step, 'clearance', kPartCutClearance), 'split', split =>
          typeof split === 'object' ? typed(split, 'fingers', kPartCutFingers) : split
        ),
        'cornerRelief',
        relief => typed(relief, 'diameter', kPartCutCornerRelief)
      )
    );
  const copyTransforms =
    document.copyTransforms &&
    each(document.copyTransforms, move => {
      owner = { partId: move.partId, operationId: move.id };
      return moved(move, kCopyTranslations, kCopyRotation);
    });
  if (
    parts === document.parts &&
    planes === document.planes &&
    partCuts === document.partCuts &&
    copyTransforms === document.copyTransforms
  )
    return document;
  return { ...document, parts, ...(planes && { planes }), ...(partCuts && { partCuts }), ...(copyTransforms && { copyTransforms }) };
}

/** Looks at every typed value without changing any. */
export function visitTypedValues(
  document: CadDocument,
  visit: { [K in keyof TypedValueEdit]: (...found: Parameters<TypedValueEdit[K]>) => void }
): void {
  mapTypedValues(document, {
    value(typed, kind, owner) {
      visit.value(typed, kind, owner);
      return typed;
    },
    pattern(pattern, owner) {
      visit.pattern(pattern, owner);
      return pattern;
    },
  });
}

const kLinearPatternUnits = { countX: 'scalar', countY: 'scalar', spacingX: 'mm', spacingY: 'mm' } as const;

/** Every typed value's expression rewritten by `edit`, which is told the unit a bare number in it has. */
export function mapTypedExpressions(document: CadDocument, edit: (expression: string, unit: CadValueUnit) => string): CadDocument {
  return mapTypedValues(document, {
    value: (typed, kind) => ({ expression: edit(typed.expression, kind.unit), value: typed.value }),
    pattern(pattern) {
      const expressions = { ...pattern.expressions };
      let changed = false;
      for (const key of Object.keys(kLinearPatternUnits) as (keyof typeof kLinearPatternUnits)[]) {
        const expression = expressions[key];
        if (!expression) continue;
        expressions[key] = edit(expression, kLinearPatternUnits[key]);
        changed ||= expressions[key] !== expression;
      }
      return changed ? { ...pattern, expressions } : pattern;
    },
  });
}
