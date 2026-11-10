import { evaluateRationalCurve, rationalCurveData, type CadPoint, type CadSplineEntity } from '@wbcnc/cad';
import { combineExpressions } from './linearExpression';
import type { Len, LenXy } from './editTypes';

/** Explicit mm prevents a numeric source coordinate from becoming a dimensionless term beside a variable. */
export const lengthExpression = (value: Len) => (typeof value === 'number' ? `${value}mm` : `(${value})`);
export function weightedLength(values: readonly Len[], weights: readonly number[]): Len {
  if (values.every(value => typeof value === 'number'))
    return values.reduce<number>((sum, value, i) => sum + (value as number) * weights[i]!, 0);
  const simple = combineExpressions(values.map((value, i) => [weights[i]!, value] as const));
  if (simple !== undefined) return simple;
  let constant = 0;
  const terms = new Map<string, number>();
  values.forEach((value, i) => {
    if (typeof value === 'number') constant += value * weights[i]!;
    else terms.set(value, (terms.get(value) ?? 0) + weights[i]!);
  });
  return (
    [...terms]
      .flatMap(([value, weight]) => (Math.abs(weight) < 1e-14 ? [] : [`${weight}*${lengthExpression(value)}`]))
      .concat(Math.abs(constant) > 1e-14 ? [`${constant}mm`] : [])
      .join(' + ') || '0mm'
  );
}

/** Fixed interpolation parameters keep the native fit-point and tangent-handle identities across variable edits. */
export function splineHandleCoordinates(curve: CadSplineEntity, points: ReadonlyMap<string, CadPoint>, fits: readonly LenXy[]): LenXy[] {
  if (curve.closed) return [];
  const data = rationalCurveData(curve, points),
    n = data.poles.length;
  const rows = curve.fitParameters.map(t =>
    Array.from(
      { length: n },
      (_, column) => evaluateRationalCurve({ ...data, poles: data.poles.map((_, i) => ({ x: i === column ? 1 : 0, y: 0 })) }, t).x
    )
  );
  const first = Array<number>(n).fill(0),
    last = Array<number>(n).fill(0);
  const a = data.knots[4]!,
    b = data.knots[5]!,
    c = 1 - data.knots[n - 1]!,
    d = 1 - data.knots[n - 2]!;
  first[0] = 1 / a;
  first[1] = -1 / a - 1 / b;
  first[2] = 1 / b;
  last[n - 1] = 1 / c;
  last[n - 2] = -1 / c - 1 / d;
  last[n - 3] = 1 / d;
  const matrix = [...rows, first, last].map((row, i) => [...row, ...Array.from({ length: fits.length }, (_, j) => (i === j ? 1 : 0))]);
  for (let k = 0; k < n; k++) {
    let pivot = k;
    for (let i = k + 1; i < n; i++) if (Math.abs(matrix[i]![k]!) > Math.abs(matrix[pivot]![k]!)) pivot = i;
    [matrix[k], matrix[pivot]] = [matrix[pivot]!, matrix[k]!];
    const scale = matrix[k]![k]!;
    if (Math.abs(scale) < 1e-12) throw new Error('This spline does not have a stable interpolation basis.');
    for (let j = k; j < n + fits.length; j++) matrix[k]![j] = matrix[k]![j]! / scale;
    for (let i = 0; i < n; i++)
      if (i !== k) {
        const factor = matrix[i]![k]!;
        for (let j = k; j < n + fits.length; j++) matrix[i]![j] = matrix[i]![j]! - factor * matrix[k]![j]!;
      }
  }
  return [1, n - 2].map(index => [
    weightedLength(
      fits.map(p => p[0]),
      matrix[index]!.slice(n)
    ),
    weightedLength(
      fits.map(p => p[1]),
      matrix[index]!.slice(n)
    ),
  ]);
}
