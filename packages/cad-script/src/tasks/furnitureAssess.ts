import { cadCopyName, type CadConstruction, type CadDocument } from '@wbcnc/cad';
import { unplannedFurniturePieces } from '../furnitureCoverage';
import type { CadTaskCandidate } from './types';

type Check = (description: string, passed: boolean, expected?: unknown, actual?: unknown) => void;
type Body = NonNullable<CadTaskCandidate['report']['assembly']>['parts'][number];

/** What a rebuilt piece of seating must measure, in mm. Joint soundness is the plan's own measured checks. */
export interface FurnitureRebuild {
  recipe: CadConstruction['recipe'];
  /** Top of the seat above the floor. */
  seatHeight: number;
  /** Overall height, floor to the highest piece. */
  height: number;
  /** For a panel chair: the clear width between the two sides' inner faces. */
  clearSeatWidth?: number;
}

const near = (a: number | undefined, b: number, tolerance = 0.5) => a !== undefined && Number.isFinite(a) && Math.abs(a - b) <= tolerance;

function memberBody(document: CadDocument, bodies: readonly Body[], member: CadConstruction['members'][number] | undefined) {
  const source = member && document.parts.find(part => part.id === member.partId);
  if (!source) return undefined;
  const index = member.copyId ? (source.copies ?? []).findIndex(copy => copy.id === member.copyId) : -1;
  const name = index >= 0 ? cadCopyName(source, index) : source.name;
  return bodies.find(body => body.name === name);
}

/** Every built wooden piece is measured by a retained construction plan whose joints, fit and hardware all pass. */
export function checkPlannedFurniture(candidate: CadTaskCandidate, check: Check) {
  const loose = unplannedFurniturePieces(candidate.document).map(piece => piece.name);
  check('Every wooden piece is joined by a measured construction plan; no loose or unretained piece remains.', !loose.length, [], loose);
  const failing = candidate.report.errors.filter(error => error.code === 'construction-check').map(error => error.message);
  check('The measured joints, fit and hardware of every construction plan pass.', !failing.length, [], failing.slice(0, 5));
}

/**
 * A rebuild of one of #585's original seating designs: a retained pattern of the right kind replaces the open housings
 * or shallow notches, at the original's seat height and size. The checks measure placed geometry, never names alone.
 */
export function assessFurnitureRebuild(wanted: FurnitureRebuild, candidate: CadTaskCandidate, check: Check) {
  const { document, report } = candidate;
  const bodies = report.assembly?.parts ?? [];
  const parked = new Set(document.folders?.filter(folder => folder.suppressed).map(folder => folder.id));
  const plan = document.constructions?.find(plan => plan.recipe === wanted.recipe && !parked.has(plan.folderId));
  check(
    `The piece is built from the ${wanted.recipe} construction pattern.`,
    !!plan,
    wanted.recipe,
    document.constructions?.map(p => p.recipe)
  );
  checkPlannedFurniture(candidate, check);
  check('No pieces collide.', !!report.assembly && report.assembly.collisions.length === 0, 0, report.assembly?.collisions.length ?? null);
  const top = bodies.length ? Math.max(...bodies.map(body => body.at[2]! + body.size[2]!)) : undefined;
  const bottom = bodies.length ? Math.min(...bodies.map(body => body.at[2]!)) : undefined;
  check('The overall height matches the original.', near(top, wanted.height) && near(bottom, 0), wanted.height, top);
  const seat = memberBody(
    document,
    bodies,
    plan?.members.find(member => /^seat$/i.test(member.role))
  );
  check(
    'The seat top sits at the original seat height.',
    near(seat && seat.at[2]! + seat.size[2]!, wanted.seatHeight),
    wanted.seatHeight,
    seat && seat.at[2]! + seat.size[2]!
  );
  if (wanted.clearSeatWidth !== undefined) {
    const [left, right] = ['left-side', 'right-side'].map(role =>
      memberBody(
        document,
        bodies,
        plan?.members.find(member => member.role === role)
      )
    );
    const clear = left && right ? right.at[0]! - left.at[0]! - left.size[0]! : undefined;
    check('The clear seat width between the sides is kept.', near(clear, wanted.clearSeatWidth), wanted.clearSeatWidth, clear);
  }
}
