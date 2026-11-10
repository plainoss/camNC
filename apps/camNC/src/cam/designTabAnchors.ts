import {
  cadPartsToCut,
  closestCurvePoint,
  evaluateCurvePoint,
  isNurbsCurve,
  mirrorEvaluatedPart,
  mirroredPartId,
  type CadEntity,
  type CadPart,
  type CadPoint,
  type CadSolveResult,
  type EvaluatedCadPart,
} from '@wbcnc/cad';
import { isCut, type BoardV1 } from './boards';
import { designGeometryFingerprint } from './designGeometry';
import { asMilled, millsUndersideUp } from './millSide';

type Curve = Exclude<CadEntity, { type: 'point' }>;
const tau = Math.PI * 2;
const turn = (angle: number) => ((angle % tau) + tau) % tau;
const pointsOf = (part: CadPart) => new Map(part.sketch.entities.filter(e => e.type === 'point').map(e => [e.id, e]));
const min = (part: EvaluatedCadPart) => ({ x: Math.min(...part.outline.map(p => p.x)), y: Math.min(...part.outline.map(p => p.y)) });
const outerLineage = (part: EvaluatedCadPart) =>
  JSON.stringify(
    part.loops
      .filter(loop => loop.kind === 'outer')
      .map(loop => [loop.id, [...loop.entityIds].sort()])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  );
const cutSourceIssue = 'The design changed after cutting. Reset or place this part’s tabs for the new setup.';

function curvePoint(curve: Curve, part: CadPart, parameter: number): CadPoint | null {
  const points = pointsOf(part);
  if (isNurbsCurve(curve)) {
    try {
      return evaluateCurvePoint(curve, points, parameter);
    } catch {
      return null;
    }
  }
  if (curve.type === 'line') {
    const a = points.get(curve.startId),
      b = points.get(curve.endId);
    return a && b ? { x: a.x + (b.x - a.x) * parameter, y: a.y + (b.y - a.y) * parameter } : null;
  }
  const center = points.get(curve.centerId);
  if (!center) return null;
  let angle = parameter;
  if (curve.type === 'arc') {
    const a = points.get(curve.startId),
      b = points.get(curve.endId);
    if (!a || !b) return null;
    const start = Math.atan2(a.y - center.y, a.x - center.x);
    const sweep = turn(Math.atan2(b.y - center.y, b.x - center.x) - start);
    angle = start + sweep * parameter;
  }
  return { x: center.x + curve.radius * Math.cos(angle), y: center.y + curve.radius * Math.sin(angle) };
}

function project(curve: Curve, part: CadPart, at: CadPoint) {
  const points = pointsOf(part);
  let parameter: number;
  if (isNurbsCurve(curve)) {
    try {
      parameter = closestCurvePoint(curve, points, at).parameter;
    } catch {
      return null;
    }
  } else if (curve.type === 'line') {
    const a = points.get(curve.startId),
      b = points.get(curve.endId);
    if (!a || !b) return null;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    parameter = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / (dx * dx + dy * dy)));
  } else {
    const center = points.get(curve.centerId);
    if (!center) return null;
    parameter = Math.atan2(at.y - center.y, at.x - center.x);
    if (curve.type === 'arc') {
      const a = points.get(curve.startId),
        b = points.get(curve.endId);
      if (!a || !b) return null;
      const start = Math.atan2(a.y - center.y, a.x - center.x);
      const sweep = turn(Math.atan2(b.y - center.y, b.x - center.x) - start);
      parameter = Math.max(0, Math.min(1, turn(parameter - start) / sweep));
    }
  }
  const point = curvePoint(curve, part, parameter);
  return point ? { parameter, distance: Math.hypot(point.x - at.x, point.y - at.y) } : null;
}

/** Tabs follow their original boundary curve by ID and parameter; vanished boundaries remain explicit repairs. */
export function carryDesignTabs(
  boards: BoardV1[] | undefined,
  before: CadSolveResult | null,
  after: CadSolveResult,
  acceptedBoardSourceKeys: Readonly<Record<string, string | undefined>> = {}
): BoardV1[] | undefined {
  if (!before || !boards) return boards;
  const oldParts = new Map(before.document.parts.map(p => [p.id, p]));
  const newParts = new Map(after.document.parts.map(p => [p.id, p]));
  const oldShapes = new Map(before.parts.map(p => [p.partId, p]));
  const newShapes = new Map(after.parts.map(p => [p.partId, p]));
  // Each piece CAM cuts, with its own cuts: a copy whose cuts differ is a piece of its own and can lie another way up.
  const pieces = (result: CadSolveResult) => new Map(cadPartsToCut(result.document, result.parts).map(({ part }) => [part.partId, part]));
  const oldPieces = pieces(before),
    newPieces = pieces(after);
  return boards.map(board => {
    if (!board.tabsAt) return board;
    const tabsAt = { ...board.tabsAt };
    const designIssues = { ...board.designIssues };
    for (const [instanceId, tabs] of Object.entries(board.tabsAt)) {
      if (!tabs.length) continue;
      const partId = instanceId.split('#')[0]!;
      // A mirrored copy is cut as a part of its own, the mirror image of its part across the sketch's y axis. Its tabs
      // follow that part's curves, mirrored.
      const sourceId = partId.split(':')[0]!,
        mirrored = partId.startsWith(mirroredPartId(sourceId));
      const piece = (found: Map<string, EvaluatedCadPart>, shapes: Map<string, EvaluatedCadPart>) => {
        const source = shapes.get(sourceId);
        return found.get(partId) ?? (source && mirrored ? mirrorEvaluatedPart(source) : source);
      };
      const oldPiece = piece(oldPieces, oldShapes),
        nextPiece = piece(newPieces, newShapes);
      // A piece with cuts only from its underside lies turned over about the same axis, and can turn back when that changes.
      const turns = (shape: EvaluatedCadPart | undefined) => !!shape && millsUndersideUp(shape);
      const flipFor = (turned: boolean) => {
        const flipped = mirrored !== turned;
        return (p: CadPoint): CadPoint => (flipped ? { x: -p.x, y: p.y } : p);
      };
      const oldTurned = turns(oldPiece),
        nextTurned = turns(nextPiece);
      const oldShape = oldPiece && (oldTurned ? asMilled(oldPiece) : oldPiece),
        nextShape = nextPiece && (nextTurned ? asMilled(nextPiece) : nextPiece);
      const oldPart = oldParts.get(sourceId),
        nextPart = newParts.get(sourceId);
      if (!oldPart || !nextPart || !oldShape || !nextShape) continue;
      if (isCut(board)) {
        if (board.cut?.sourceKey && board.cut.sourceKey === acceptedBoardSourceKeys[board.id]) {
          // These tabs still belong to the original physical sheet. Its content-key guard blocks a changed design,
          // and a true geometry revert needs no tab repair. Do not turn that condition into a sticky anchor error.
          if (designIssues[instanceId] === cutSourceIssue) delete designIssues[instanceId];
        } else if (designGeometryFingerprint(oldShape) !== designGeometryFingerprint(nextShape)) {
          // Only the actual physical source key proves a revert. Keep other changes repairable if an unrequested
          // preparation is rolled back and this stock becomes editable again.
          designIssues[instanceId] ??= cutSourceIssue;
        }
        continue;
      }
      // Keep explicitly unresolved anchors until the user resets or replaces the tabs.
      if (designIssues[instanceId]) continue;
      // Trim can retain a curve ID while shortening its parameter domain. A changed outer profile lineage cannot
      // safely reuse that curve's old parameter, even when the individual boundary ID still exists.
      if (outerLineage(oldShape) !== outerLineage(nextShape)) {
        designIssues[instanceId] = 'A tab boundary changed. Reset or place this part’s tabs again on Boards.';
        continue;
      }
      const oldOrigin = min(oldShape),
        nextOrigin = min(nextShape);
      const outerIds = new Set(oldShape.loops.filter(l => l.kind === 'outer').flatMap(l => l.entityIds));
      const nextOuterIds = new Set(nextShape.loops.filter(l => l.kind === 'outer').flatMap(l => l.entityIds));
      const curves = oldPart.sketch.entities.filter((e): e is Curve => e.type !== 'point' && outerIds.has(e.id));
      const flipOld = flipFor(oldTurned),
        flipNext = flipFor(nextTurned);
      let failed = false;
      const mapped = tabs.map(at => {
        const sourceAt = flipOld({ x: at.x + oldOrigin.x, y: at.y + oldOrigin.y });
        const anchor = curves
          .flatMap(curve => {
            const hit = project(curve, oldPart, sourceAt);
            return hit ? [{ curve, ...hit }] : [];
          })
          .sort((a, b) => a.distance - b.distance)[0];
        const curve = anchor && nextPart.sketch.entities.find((e): e is Curve => e.id === anchor.curve.id && e.type === anchor.curve.type);
        const point = curve && nextOuterIds.has(curve.id) && curvePoint(curve, nextPart, anchor!.parameter);
        if (!anchor || anchor.distance > 0.5 || !point) {
          failed = true;
          return at;
        }
        const placed = flipNext(point);
        return { x: placed.x - nextOrigin.x, y: placed.y - nextOrigin.y };
      });
      if (failed) designIssues[instanceId] = 'A tab boundary changed. Reset or place this part’s tabs again on Boards.';
      else tabsAt[instanceId] = mapped;
    }
    return { ...board, tabsAt, designIssues: Object.keys(designIssues).length ? designIssues : undefined };
  });
}

/** A repaired tab placement clears only its own unresolved reference. */
export function clearDesignIssue(board: BoardV1, instanceId: string): Pick<BoardV1, 'designIssues'> {
  const issues = { ...board.designIssues };
  delete issues[instanceId];
  return { designIssues: Object.keys(issues).length ? issues : undefined };
}
