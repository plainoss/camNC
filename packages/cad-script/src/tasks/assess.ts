import { cadCopyName, evaluateCadDocument, evaluatedPartCopy, pointInPolygon, type CadDocument, type EvaluatedCadPart } from '@wbcnc/cad';
import type { CadReport } from '../inspect';
import type { CadSavedTask, CadTaskAssessment, CadTaskCandidate, CadTaskCheck } from './types';
import { cadTaskFamilyMaterial, cadTaskMaterial } from './material';

const close = (a: number, b: number) => Number.isFinite(a) && Math.abs(a - b) < 0.05;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const matches = (name: string, role: string) => new RegExp(`\\b${role}\\b`, 'i').test(name);
type Body = NonNullable<CadReport['assembly']>['parts'][number];
function size(bodies: readonly Body[]): number[] {
  return [0, 1, 2].map(axis =>
    bodies.length ? Math.max(...bodies.map(body => body.at[axis] + body.size[axis])) - Math.min(...bodies.map(body => body.at[axis])) : NaN
  );
}
function ids(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(ids);
  return Object.entries(value).flatMap(([key, entry]) => (key === 'id' && typeof entry === 'string' ? [entry] : ids(entry)));
}
function shelfGaps(bodies: readonly Body[]): number[] {
  const shelves = bodies.filter(body => matches(body.name, 'shelf')).sort((a, b) => a.at[2] - b.at[2]);
  const bottom = bodies.find(body => matches(body.name, 'bottom'));
  const top = bodies.find(body => matches(body.name, 'top'));
  if (!shelves.length || !bottom || !top) return [];
  const boards = [bottom, ...shelves, top];
  return boards.slice(1).map((body, index) => body.at[2] - boards[index].at[2] - boards[index].size[2]);
}
const floor = (part: EvaluatedCadPart) => (part.cuts ?? []).filter(cut => !cut.through).map(cut => part.thickness - cut.to);

/** These tests express the requested geometry, not snapshots of the trial's answers. */
export function assessCadTask(
  task: CadSavedTask,
  start: CadDocument | null,
  candidate: CadTaskCandidate,
  response = ''
): CadTaskAssessment {
  const { document, report } = candidate;
  const checks: CadTaskCheck[] = [];
  const check = (description: string, passed: boolean, expected?: unknown, actual?: unknown) =>
    checks.push({ description, passed, ...(expected !== undefined && { expected }), ...(actual !== undefined && { actual }) });
  check('The candidate checks successfully.', candidate.ok && report.ok && !candidate.scriptError, true, candidate.ok && report.ok);
  const bodies = report.assembly?.parts ?? [];
  const shelves = bodies.filter(body => matches(body.name, 'shelf')).sort((a, b) => a.at[2] - b.at[2]);
  const overall = (wanted: number[]) =>
    check(
      'Overall placed size matches the request (width, depth, height).',
      size(bodies).every((n, i) => close(n, wanted[i])),
      wanted,
      size(bodies)
    );
  const shelfCount = (wanted: number) =>
    check('The requested number of shelves is present.', shelves.length === wanted, wanted, shelves.length);
  const structuralBoard = (wanted: number) => {
    const parts = report.parts.filter(part => !matches(part.name, 'back') && part.outline);
    check(
      'Every structural board has the requested thickness.',
      parts.length > 0 && parts.every(part => close(part.thickness, wanted)),
      wanted,
      parts.map(part => ({ name: part.name, thickness: part.thickness }))
    );
  };
  const joints = (wanted: number, exact = false) => {
    const counts = report.parts
      .filter(part => matches(part.name, 'side'))
      .map(part => part.cuts.filter(cut => matches(cut.ref, 'shelf') && cut.to - cut.from > 0.05).length);
    check(
      'The sides have the requested number of positive-depth shelf housings.',
      counts.length > 0 && counts.every(count => (exact ? count === wanted : count >= wanted)),
      wanted,
      counts
    );
  };
  const namedPieceFolder = (name: RegExp) => {
    const old = new Set(start?.parts.map(part => part.id));
    const added = document.parts.filter(part => !old.has(part.id)).map(part => part.id);
    check(
      'The new piece is grouped in its own appropriately named folder.',
      added.length > 0 &&
        !!document.folders?.some(
          folder => name.test(folder.name) && folder.partIds.length === added.length && added.every(id => folder.partIds.includes(id))
        )
    );
  };
  if (task.id === 'A1' || task.id === 'H1') {
    const bounds = size(bodies);
    check('Width is 800 mm and height is 900 mm.', close(bounds[0], 800) && close(bounds[2], 900), [800, 900], [bounds[0], bounds[2]]);
    shelfCount(3);
    const gaps = shelfGaps(bodies);
    check('The four clear gaps are equal.', gaps.length === 4 && gaps.every(gap => close(gap, gaps[0])), 'four equal clear gaps', gaps);
    const kept = new Set(ids(document));
    const missing = ids(start).filter(id => !kept.has(id));
    check('All existing entity IDs survive.', missing.length === 0, [], missing);
  } else if (task.id === 'A2') {
    shelfCount(3);
    const source = document.parts.find(part => matches(part.name, 'shelf'));
    const evaluated = source && candidate.parts.find(part => part.partId === source.id);
    const pieces =
      evaluated && source
        ? [
            { id: source.id, name: source.name, part: evaluated },
            ...(source.copies ?? []).map((copy, index) => ({
              id: `${source.id}:${copy.id}`,
              name: cadCopyName(source, index),
              part: evaluatedPartCopy(evaluated, copy),
            })),
          ]
        : [];
    const ordered = shelves.map(body => pieces.find(piece => piece.name === body.name));
    const holes = ordered.map(piece =>
      piece ? [...piece.part.holes, ...(piece.part.cuts ?? []).filter(cut => cut.through).map(cut => cut.outline)] : []
    );
    check(
      'Only the middle shelf has a through hole.',
      same(
        holes.map(loops => loops.length),
        [0, 1, 0]
      ),
      [0, 1, 0],
      holes.map(loops => loops.length)
    );
    const hole = holes[1]?.[0];
    const middle = ordered[1]?.part;
    const span =
      hole &&
      [0, 1].map(axis => {
        const values = hole.map(point => (axis === 0 ? point.x : point.y));
        return Math.max(...values) - Math.min(...values);
      });
    check('The cable hole is 60 mm in diameter.', !!span && span.every(value => Math.abs(value - 60) < 0.2), [60, 60], span ?? null);
    const rearGap = hole && middle ? Math.max(...middle.outline.map(p => p.y)) - Math.max(...hole.map(p => p.y)) : NaN;
    check(
      'The hole is inside the shelf and near its back.',
      !!hole && !!middle && hole.every(p => pointInPolygon(p, middle.outline)) && rearGap >= 0 && rearGap <= 60,
      'inside; rear gap 0–60 mm',
      rearGap
    );
    const beforeSource = start?.parts.find(part => part.id === source?.id);
    const before = start && evaluateCadDocument(start).parts.find(part => part.partId === beforeSource?.id);
    const baseline = beforeSource && before ? cadTaskFamilyMaterial(beforeSource, before) : new Map<string, string>();
    check(
      'Uncut siblings retain their complete original material, including holes and blind cuts.',
      baseline.size > 0 &&
        ordered.filter((_, index) => index !== 1).every(piece => !!piece && baseline.get(piece.id) === cadTaskMaterial(piece.part))
    );
  } else if (task.id === 'A3') {
    namedPieceFolder(/cupboard|cabinet/i);
    const original = start?.parts ?? [];
    check(
      'Every original part is unchanged.',
      original.length > 0 &&
        original.every(part =>
          same(
            document.parts.find(p => p.id === part.id),
            part
          )
        )
    );
    const before = start && evaluateCadDocument(start).parts;
    check(
      'Every original part retains its evaluated geometry, including cuts made by other parts.',
      !!before?.length &&
        before.every(part => {
          const source = original.find(source => source.id === part.partId)!,
            current = candidate.parts.find(candidate => candidate.partId === part.partId);
          if (!current) return false;
          const baseline = cadTaskFamilyMaterial(source, part),
            actual = cadTaskFamilyMaterial(source, current);
          return baseline.size === actual.size && [...baseline].every(([id, material]) => actual.get(id) === material);
        })
    );
    const originalNames = new Set(
      original.flatMap(part => [part.name, ...(part.copies ?? []).map((_, index) => cadCopyName(part, index))])
    );
    const oldBodies = bodies.filter(body => originalNames.has(body.name));
    const added = bodies.filter(body => !originalNames.has(body.name));
    const oldSize = size(oldBodies),
      newSize = size(added);
    check(
      'The added cupboard is 400 mm wide with the original height and depth.',
      close(newSize[0], 400) && close(newSize[1], oldSize[1]) && close(newSize[2], oldSize[2]),
      [400, oldSize[1], oldSize[2]],
      newSize
    );
    const oldRight = Math.max(...oldBodies.map(body => body.at[0] + body.size[0]));
    const newLeft = Math.min(...added.map(body => body.at[0]));
    check('The added cupboard is directly to the right.', close(oldRight, newLeft), oldRight, newLeft);
  } else if (task.id === 'B1' || task.id === 'B2') {
    if (task.id === 'B1') namedPieceFolder(/bench/i);
    overall([task.id === 'B1' ? 900 : 1100, 350, 450]);
    structuralBoard(18);
    shelfCount(1);
    const seat = bodies.find(body => matches(body.name, 'seat'));
    check(
      'A seat is at the top, above the shoe shelf.',
      !!seat && close(seat.at[2] + seat.size[2], 450) && shelves.length === 1 && seat.at[2] > shelves[0].at[2]
    );
    joints(1);
    if (task.id === 'B2') {
      const divider = bodies.find(body => matches(body.name, 'divider'));
      check(
        'An upright divider is centred between seat and shelf.',
        !!divider &&
          !!seat &&
          shelves.length === 1 &&
          close(divider.at[0] + divider.size[0] / 2, 550) &&
          close(divider.at[2], shelves[0].at[2] + shelves[0].size[2]) &&
          close(divider.at[2] + divider.size[2], seat.at[2])
      );
      const seatSource = document.parts.find(part => matches(part.name, 'seat'));
      const arcs = seatSource?.sketch.entities.filter(entity => entity.type === 'arc' && close(entity.radius, 30)) ?? [];
      const fillets =
        seatSource?.fillets?.filter(fillet => close(fillet.radius, 30)).reduce((count, fillet) => count + fillet.corners.length, 0) ?? 0;
      check('Two seat corners have radius 30 mm.', arcs.length >= 2 || fillets >= 2, 2, Math.max(arcs.length, fillets));
    }
  } else if (task.id === 'C1' || task.id === 'C2' || task.id === 'C3') {
    if (task.id === 'C1') namedPieceFolder(/book|shelf/i);
    overall([800, 220, 1000]);
    structuralBoard(task.id === 'C3' ? 15 : 18);
    const back = report.parts.filter(part => matches(part.name, 'back'));
    check(
      'The back remains 6 mm.',
      back.length === 1 && close(back[0].thickness, 6),
      6,
      back.map(part => part.thickness)
    );
    shelfCount(4);
    if (task.id === 'C1') joints(4, true);
    if (task.id === 'C2') {
      joints(1, true);
      const housingNames = report.parts.flatMap(part =>
        matches(part.name, 'side') ? part.cuts.filter(cut => matches(cut.ref, 'shelf')).map(cut => cut.ref) : []
      );
      check(
        'The remaining housing is for the second shelf.',
        housingNames.length > 0 && housingNames.every(name => name === shelves[1]?.name),
        shelves[1]?.name,
        housingNames
      );
      const patterns = document.parts
        .filter(part => matches(part.name, 'side'))
        .flatMap(part => (part.features ?? []).flatMap(feature => (feature.type === 'sketch' ? feature.sketch.constraints : [])))
        .filter(constraint => constraint.type === 'linearPattern');
      check(
        'Pin holes have a 32 mm vertical pitch.',
        patterns.some(pattern => close(Math.abs(pattern.stepX.y), 32) || close(Math.abs(pattern.stepY.y), 32))
      );
    }
    if (task.id === 'C3') {
      const floors = candidate.parts.filter(part => matches(part.name, 'side')).flatMap(floor);
      check(
        'The check exposes a 3 mm floor below the pin holes.',
        floors.some(value => close(value, 3)),
        3,
        floors.length ? Math.min(...floors) : null
      );
    }
  } else if (task.id === 'stool') {
    check(
      'Dimensions and joints are stated for acceptance.',
      /\d+\s*(?:mm|cm|inch)/i.test(response) && /joint|tenon|mortise|housing|lap/i.test(response)
    );
    const folders = document.folders?.filter(folder => /stool/i.test(folder.name)) ?? [];
    check('The stool is in a named folder.', folders.length > 0);
    // Joint words are not construction: a built stool needs a saved pattern whose measured checks all pass.
    check(
      'A built stool has a retained construction pattern with measured joints and a fastened seat.',
      !!document.constructions?.some(plan => folders.some(folder => plan.folderId === folder.id)) &&
        !report.errors.some(error => error.code === 'construction-check')
    );
  } else if (task.id === 'shelf-description' || task.id === 'shelf-picture') {
    overall([600, 220, 800]);
    structuralBoard(18);
    shelfCount(3);
    const sides = bodies.filter(body => matches(body.name, 'side'));
    check('Two full-height sides frame the shelves.', sides.length === 2 && sides.every(side => close(side.size[2], 800)));
    check('The back is open.', !bodies.some(body => matches(body.name, 'back')));
    const intervals = shelves.slice(1).map((shelf, i) => shelf.at[2] - shelves[i].at[2]);
    check('Shelf spacing is even.', intervals.length === 2 && close(intervals[0], intervals[1]));
    joints(3, true);
    check('The piece belongs to a named folder.', !!document.folders?.some(folder => folder.name.trim().length > 0));
  }
  return { checks, automaticPass: checks.every(check => check.passed), review: [...task.review] };
}
