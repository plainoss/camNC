import { assemblySweepCollisions, type CadAssemblyPiece, type CadConstruction, type CadDocument, type EvaluatedCadPart } from '@wbcnc/cad';
import { furnitureMembers } from './furnitureGeometry';

/** Steps that bring members together, so they must say which ones travel. Curing and driving hardware move nothing. */
const kMovingActions: ReadonlySet<CadConstruction['assembly'][number]['action']> = new Set([
  'bond-laminations',
  'insert-crosspieces',
  'fit-second-side',
  'install-keys',
  'attach-seat',
]);

export interface FurnitureAssemblyCheck {
  /** The step, numbered from 1, and what it found in the way. */
  id: string;
  check: string;
  passed: boolean;
  actual?: number;
  expected?: number;
}

/**
 * Walks a plan's assembly order on the evaluated geometry. In each step the `moving` members travel together along
 * its axis, from clear of everything, into their final place; none may pass through the material of what is already
 * there: the step's other members, and every member already in its final place. A member reaches its final place at
 * the last step that moves it (earlier moves build a sub-assembly), or at its first step if no step moves it.
 *
 * This is a straight-line insertion check on the final geometry. It does not model flexing, clamps, glue squeeze-out
 * or a person's hands; fastener access is the hardware check's.
 */
export function checkFurnitureAssembly(
  document: CadDocument,
  parts: readonly EvaluatedCadPart[],
  plan: CadConstruction
): FurnitureAssemblyCheck[] {
  const members = furnitureMembers(document, parts, plan);
  const checks: FurnitureAssemblyCheck[] = [];
  const steps = plan.assembly;
  const lastMove = new Map<string, number>(),
    firstSeen = new Map<string, number>();
  steps.forEach((step, i) => {
    for (const role of step.moving ?? []) lastMove.set(role, i);
    for (const role of step.roles) if (!firstSeen.has(role)) firstSeen.set(role, i);
  });
  const placedAt = (role: string) => lastMove.get(role) ?? firstSeen.get(role) ?? Infinity;
  const unplaced = plan.members.filter(member => !firstSeen.has(member.role)).map(member => member.role);
  checks.push({
    id: unplaced.length ? `assembly (${unplaced.slice(0, 4).join(', ')})` : 'assembly',
    check: 'Every member has a step in the assembly order.',
    passed: !unplaced.length,
  });
  const piece = (role: string): CadAssemblyPiece[] => {
    const member = members.get(role);
    return member ? [{ id: role, name: role, part: member.shape, placement: member.at }] : [];
  };
  steps.forEach((step, i) => {
    const id = `assembly-${i + 1}-${step.action}`;
    if (!step.moving?.length) {
      if (kMovingActions.has(step.action)) checks.push({ id, check: 'The assembly step says which members move.', passed: false });
      return;
    }
    const moving = new Set(step.moving);
    const fixed = new Set([
      ...step.roles.filter(role => !moving.has(role)),
      ...plan.members.map(member => member.role).filter(role => !moving.has(role) && placedAt(role) < i),
    ]);
    const axis = 'xyz'.indexOf(step.axis[1]!) as 0 | 1 | 2;
    const collisions = assemblySweepCollisions(step.moving.flatMap(piece), [...fixed].flatMap(piece), axis, step.axis[0] === '+' ? 1 : -1);
    const [first] = collisions;
    checks.push({
      id: first ? `${id} (${first.moving} meets ${first.fixed} ${first.offset} mm short of its place)` : id,
      check: 'The moving members travel into place without passing through material already there.',
      passed: !first,
      ...(first && { actual: first.volume, expected: 0 }),
    });
  });
  return checks;
}
