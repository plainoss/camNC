import type { CadPartPattern } from '@wbcnc/cad';

/** A full ring, preserving an existing pattern's count when changing its type. */
export function circularPartPatternStart(pattern?: CadPartPattern): Omit<CadPartPattern, 'id'> {
  return {
    axis: pattern?.axis ?? 'z',
    count: pattern?.count ?? 4,
    spacing: pattern?.spacing ?? 100,
    ...(pattern?.suppressed && { suppressed: pattern.suppressed }),
    ...(pattern?.countExpression && { countExpression: pattern.countExpression }),
    circular: { origin: [0, 0, 0], axis: [0, 0, 1], angle: 360, equalSpacing: true },
  };
}
