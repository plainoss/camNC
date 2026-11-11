import { lengthExpression } from './curveExpressions';
import { fitSketchBounds } from './sketchFit';
import { createSketchCurves } from './sketchCurves';
import { prepareEmptyStudio } from './emptyStudio';
import { checkedDesignApi } from './argumentChecks';
import { buildConstraintForSelection } from '@wbcnc/cad-editor/constraintCommands';
import {
  addArc,
  addCircle,
  addConstraint,
  addFaceSketch,
  addCopyFaceSketch,
  setCopyCutDepth,
  addLine,
  addPartCopy,
  addPartCut,
  cadFaceFacing,
  evaluateCadDocument,
  resolveDrawnPlacements,
  setPartPattern,
  CAD_MAX_PART_PATTERN,
  addRectangle,
  cadFaceSketches,
  cadVariableScope,
  cadSketchRegions,
  createCadDocument,
  createCadPart,
  filletLineCorners,
  linearPatternSketchEntities,
  newCadId,
  parseCadValue,
  pointInPolygon,
  polygonArea,
  removeCadFeature,
  setCadVariable,
  setCutDepth,
  type CadDocument,
  type CadFaceRef,
  type CadDrawnOn,
  type CadPart,
  type CadPlacement,
  type CadPointEntity,
  type CadSketch,
  type EvaluatedCadPart,
  type NewCadConstraint,
  cadCopyName,
  resolvePartPatterns,
  initializeCadSolver,
  solveCadDocumentNow,
} from '@wbcnc/cad';
import { combineExpressions, differenceExpression } from './linearExpression';
import { inspectCadDocument, shortHandles, type CadExpectation, type CadReport } from './inspect';
import { CadScriptError, fail, resolveHandle, existingDesignEdit } from './editExisting';
import { runFolderScope } from './folderScope';

export type * from './editTypes';
import type {
  Xy,
  Len,
  LenXy,
  CadAxis,
  CadRef,
  SketchEdit,
  PathEdit,
  PartEdit,
  PartCopy,
  CadPlaceOptions,
  DesignEdit,
  CadScript,
} from './editTypes';

/** Identity, so a design file gets the API's types without importing them by hand. */
export const design = (script: CadScript) => script;

const axes: Record<CadAxis, [number, number, number]> = {
  '+x': [1, 0, 0],
  '-x': [-1, 0, 0],
  '+y': [0, 1, 0],
  '-y': [0, -1, 0],
  '+z': [0, 0, 1],
  '-z': [0, 0, -1],
};

/** The turn that takes the part's x, y and z to these directions, as a unit quaternion x, y, z, w. */
function rotationTo(ex: readonly number[], ey: readonly number[]): CadPlacement['rotation'] {
  const ez = [ex[1]! * ey[2]! - ex[2]! * ey[1]!, ex[2]! * ey[0]! - ex[0]! * ey[2]!, ex[0]! * ey[1]! - ex[1]! * ey[0]!];
  const [m00, m10, m20] = ex as [number, number, number],
    [m01, m11, m21] = ey as [number, number, number],
    [m02, m12, m22] = ez as [number, number, number];
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m21 - m12) * s, (m02 - m20) * s, (m10 - m01) * s, 0.25 / s];
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return [0.25 * s, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s];
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return [(m01 + m10) / s, 0.25 * s, (m12 + m21) / s, (m02 - m20) / s];
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return [(m02 + m20) / s, (m12 + m21) / s, 0.25 * s, (m10 - m01) / s];
}

function createDesignEdit(start: CadDocument, expectations: Map<string, CadExpectation[]>) {
  const initial = prepareEmptyStudio(start);
  let document = initial.document;
  let variablesDirty = false;
  const solveForQuery = () => {
    if (!variablesDirty) return;
    // Variable edits change dimension values before they move vertices. A geometric pick must see the solved shape.
    const solved = solveCadDocumentNow(document, { sketchOnly: true });
    if (solved.status !== 'solved')
      fail(
        `The design could not be solved before this geometric query: ${solved.diagnostics.find(d => d.severity === 'error')?.message ?? solved.status}`
      );
    document = solved.document;
    variablesDirty = false;
  };
  const closures: { partId: string; sketchId: string; edgeId: string; from: Xy; to: Xy }[] = [];
  const measure = (value: Len, what: string, unit: 'mm' | 'scalar' | 'deg' = 'mm'): number => {
    if (typeof value === 'number') return value;
    const result = parseCadValue(value, { unit, variables: cadVariableScope(document) });
    return 'error' in result ? fail(`${what} "${value}": ${result.error}`) : result.value;
  };
  const lengthTerm = (value: Len) => lengthExpression(value, cadVariableScope(document));
  const expressionOf = (value: Len) => (typeof value === 'string' ? { expression: value } : {});
  const placementOf = ({ at, x = '+x', y = '+y' }: CadPlaceOptions): CadPlacement => {
    const ex = axes[x],
      ey = axes[y];
    if (!ex || !ey) fail(`Axes are written like '+x' or '-z', not ${x} and ${y}.`);
    if (ex.some((value, i) => value !== 0 && ey[i] !== 0)) fail(`The part's x and y can't both point along ${x[1]}.`);
    const position = at.map((value, i) => measure(value, `Position ${'xyz'[i]}`)) as [number, number, number];
    const expressions = at.map(value => (typeof value === 'string' ? value : null)) as [string | null, string | null, string | null];
    return { position, rotation: rotationTo(ex, ey), ...(expressions.some(Boolean) && { positionExpressions: expressions }) };
  };
  const minusHalf = (a: Len, b: Len): Len => (typeof a === 'number' && typeof b === 'number' ? a - b / 2 : `(${a}) - (${b})/2`);
  const replacePart = (partId: string, edit: (part: CadPart) => CadPart) => {
    document = { ...document, parts: document.parts.map(part => (part.id === partId ? edit(part) : part)) };
  };
  const partOf = (partId: string) => document.parts.find(part => part.id === partId)!;
  // A cut-parts tool `<partId>:<copyId>` cuts with that one copy.
  // An unnamed copy is named by its place among the part's copies, which later copies can change.
  const copyHandle = (partId: string, copyId: string): PartCopy => ({
    id: `${partId}:${copyId}`,
    get name() {
      const part = partOf(partId);
      return cadCopyName(part, part.copies?.findIndex(copy => copy.id === copyId) ?? -1);
    },
    sketchOn(face) {
      const on: CadFaceRef = typeof face === 'object' ? { floorOf: face.floorOf.id } : face;
      try {
        const result = addCopyFaceSketch(document, partId, copyId, on);
        document = result.document;
        return sketchEdit(partId, result.sketchId);
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'This copy cannot be sketched on.');
      }
    },
    cut({ sketchId, regionId }, { depth }) {
      const mm = depth === 'through' ? depth : measure(depth, 'Depth');
      if (mm !== 'through' && !(mm > 0)) return fail('A cut needs a positive depth or through.');
      try {
        document = setCopyCutDepth(
          document,
          partId,
          copyId,
          sketchId,
          regionId,
          mm,
          typeof depth === 'string' && depth !== 'through' ? depth : undefined
        );
        return {
          id: partOf(partId).features!.find(
            feature => feature.type === 'cut' && feature.copyId === copyId && feature.sketchId === sketchId && feature.regionId === regionId
          )!.id,
        };
      } catch (error) {
        return fail(error instanceof Error ? error.message : 'This copy cannot be cut.');
      }
    },
  });
  const sketchOf = (partId: string, sketchId: string): CadSketch => {
    const part = partOf(partId);
    return part.sketch.id === sketchId ? part.sketch : cadFaceSketches(part).find(face => face.sketch.id === sketchId)!.sketch;
  };
  const setSketch = (partId: string, sketchId: string, sketch: CadSketch) =>
    replacePart(partId, part =>
      part.sketch.id === sketchId
        ? (() => {
            // Drawing into the starter uses its original implicit extrude, just as editing it in the studio does.
            const next = { ...part, sketch };
            if (part.id === initial.starterPartId && sketch.entities.some(entity => entity.type !== 'point')) delete next.extrude;
            return next;
          })()
        : { ...part, features: part.features?.map(f => (f.type === 'sketch' && f.sketch.id === sketchId ? { ...f, sketch } : f)) }
    );

  const sketchEdit = (partId: string, sketchId: string): SketchEdit => {
    const current = () => sketchOf(partId, sketchId);
    const apply = (edit: (sketch: CadSketch) => CadSketch) => setSketch(partId, sketchId, edit(current()));
    /** Runs a drawing helper, then reports the entities it added. */
    const added = (edit: (sketch: CadSketch) => CadSketch) => {
      const before = new Set(current().entities.map(e => e.id));
      apply(edit);
      return current().entities.filter(e => !before.has(e.id));
    };
    const constrain = (constraint: NewCadConstraint) => apply(sketch => addConstraint(sketch, constraint));
    /** Runs a drawing helper, then gives the dimensions it added, by type, the expressions their values came from. */
    const dimensioned = (edit: (sketch: CadSketch) => CadSketch, values: Partial<Record<string, Len>>) => {
      const before = new Set(current().constraints.map(c => c.id));
      const made = added(edit);
      apply(sketch => ({
        ...sketch,
        constraints: sketch.constraints.map(c => (before.has(c.id) ? c : { ...c, ...expressionOf(values[c.type] ?? 0) })),
      }));
      return made;
    };
    const pointNear = ([x, y]: Xy) =>
      current().entities.find((e): e is CadPointEntity => e.type === 'point' && Math.hypot(e.x - x, e.y - y) < 1e-7)!;
    const isPlaced = (pointId: string) =>
      current().constraints.some(c => (c.type === 'positionX' || c.type === 'positionY') && c.pointId === pointId);
    /**
     * A point of its own where `owners` meet the fixed origin. Drawing reuses the origin when a point lands on it, which
     * would pin a position that's meant to follow an expression.
     */
    const detach = (pointId: string, owners: readonly string[]): CadRef => {
      const origin = current().entities.find((e): e is CadPointEntity => e.id === pointId)!;
      const own = { id: newCadId(), type: 'point' as const, x: origin.x, y: origin.y };
      const swap = (id: string) => (id === pointId ? own.id : id);
      apply(sketch => ({
        ...sketch,
        entities: [
          ...sketch.entities.map(e => {
            if (!owners.includes(e.id)) return e;
            if (e.type === 'line') return { ...e, startId: swap(e.startId), endId: swap(e.endId) };
            if (e.type === 'arc') return { ...e, startId: swap(e.startId), endId: swap(e.endId), centerId: swap(e.centerId) };
            if (e.type === 'circle') return { ...e, centerId: swap(e.centerId) };
            if (e.type === 'bezier' || e.type === 'spline')
              return {
                ...e,
                startId: swap(e.startId),
                endId: swap(e.endId),
                controlPointIds: e.controlPointIds.map(swap),
                ...(e.type === 'spline' && { fitPointIds: e.fitPointIds.map(swap) }),
              };
            return e;
          }),
          own,
        ],
      }));
      return { id: own.id };
    };
    const typed = (at: LenXy) => at.some(value => typeof value === 'string');
    const place = (point: CadRef, [x, y]: LenXy) => {
      constrain({ type: 'positionX', pointId: point.id, value: measure(x, 'X'), label: 'X', ...expressionOf(x) });
      constrain({ type: 'positionY', pointId: point.id, value: measure(y, 'Y'), label: 'Y', ...expressionOf(y) });
    };
    const curves = createSketchCurves({ current, apply, measure, place, lengthTerm });
    const self: SketchEdit = {
      bezier: curves.bezier,
      spline: curves.spline,
      ellipse: curves.ellipse,
      offset: curves.offset,
      fitBounds(items, options) {
        solveForQuery();
        return fitSketchBounds({ current, apply, measure, place, lengthTerm }, items, options);
      },
      id: sketchId,
      rect({ w, h, at, center }) {
        const width = measure(w, 'Width'),
          height = measure(h, 'Height');
        if (!(width > 0 && height > 0)) fail(`A rectangle needs a positive size, not ${width} × ${height}.`);
        if (!at === !center) fail('A rectangle needs exactly one of at or center.');
        const [ax, ay] = at ?? [minusHalf(center![0], w), minusHalf(center![1], h)];
        const made = dimensioned(
          sketch => addRectangle(sketch, { x: measure(ax, 'X'), y: measure(ay, 'Y'), width, height, dimensioned: true, positioned: true }),
          { distanceX: w, distanceY: h, positionX: ax, positionY: ay }
        );
        const [bottom, right, top, left] = made.filter(e => e.type === 'line');
        const startOf = (edge: (typeof made)[number]) => ({ id: (edge as { startId: string }).startId });
        return { edges: { bottom: bottom!, right: right!, top: top!, left: left! }, corners: [bottom!, right!, top!, left!].map(startOf) };
      },
      circle({ at: [x, y], d }) {
        const diameter = measure(d, 'Diameter');
        if (!(diameter > 0)) fail(`A circle needs a positive diameter, not ${diameter}.`);
        const circle = dimensioned(
          sketch =>
            addCircle(sketch, { x: measure(x, 'X'), y: measure(y, 'Y'), radius: diameter / 2, dimensioned: true, positioned: true }),
          { diameter: d, positionX: x, positionY: y }
        ).find(e => e.type === 'circle')!;
        const origin = current().entities.find(e => e.id === circle.centerId);
        if (origin?.type === 'point' && origin.fixed && typed([x, y])) {
          const center = detach(circle.centerId, [circle.id]);
          place(center, [x, y]);
          return { id: circle.id, center };
        }
        return { id: circle.id, center: { id: circle.centerId } };
      },
      polygon(points) {
        if (points.length < 3) fail('A polygon needs at least 3 points.');
        const edges = points.map((from, i) => {
          const to = points[(i + 1) % points.length]!;
          return added(sketch => addLine(sketch, { x1: from[0], y1: from[1], x2: to[0], y2: to[1] })).find(e => e.type === 'line')!;
        });
        const corners = points.map(pointNear);
        points.forEach((at, i) => {
          if (!corners[i]!.fixed && !isPlaced(corners[i]!.id)) place(corners[i]!, at);
        });
        return { edges, corners };
      },
      path(from) {
        type P = { x: number; y: number };
        const at = (point: LenXy): P => ({ x: measure(point[0], 'X'), y: measure(point[1], 'Y') });
        const start = at(from);
        const vertices: { at: P; typed: LenXy }[] = [{ at: start, typed: from }];
        const edges: CadRef[] = [];
        let cursor = start;
        let cursorTyped = from;
        // Which way the last segment leaves its end, for a tangent arc after it.
        let heading: P | undefined;
        let closed = false;
        const unit = (v: P) => {
          const length = Math.hypot(v.x, v.y);
          return { x: v.x / length, y: v.y / length };
        };
        const left = (v: P) => ({ x: -v.y, y: v.x });
        const open = () => {
          if (closed) fail('This path is already closed.');
        };
        const arrive = (to: LenXy, point: P) => {
          if (Math.hypot(point.x - cursor.x, point.y - cursor.y) < 1e-6) fail(`The path is already at ${to.join(', ')}.`);
          const back = Math.hypot(point.x - start.x, point.y - start.y) < 1e-6;
          // Ending on the start reuses its point, so the loop closes.
          const end = back ? start : point;
          if (!back) vertices.push({ at: point, typed: to });
          return end;
        };
        const edit: PathEdit = {
          lineTo(to) {
            open();
            const end = arrive(to, at(to));
            const line = added(sketch => addLine(sketch, { x1: cursor.x, y1: cursor.y, x2: end.x, y2: end.y })).find(
              e => e.type === 'line'
            )!;
            edges.push({ id: line.id });
            heading = unit({ x: end.x - cursor.x, y: end.y - cursor.y });
            cursor = end;
            cursorTyped = to;
            return edit;
          },
          arcTo(to, how) {
            open();
            const from = cursor,
              target = at(to);
            if (!('tangent' in how)) {
              const r = measure(how.r, 'Radius'),
                half = Math.hypot(target.x - from.x, target.y - from.y) / 2;
              // A half circle's radius says nothing its ends don't, which leaves it free: draw it as two quarters.
              if (Math.abs(r - half) < 1e-6 * Math.max(1, r)) {
                const middle = { x: (from.x + target.x) / 2, y: (from.y + target.y) / 2 },
                  out = { x: from.x - middle.x, y: from.y - middle.y };
                const top = how.clockwise ? { x: middle.x + out.y, y: middle.y - out.x } : { x: middle.x - out.y, y: middle.y + out.x };
                // The point between the quarters is written from the ends, so it follows them when a variable changes.
                const [fx, fy] = vertices.at(-1)!.typed,
                  [tx, ty] = to;
                const turn = how.clockwise ? -1 : 1;
                // middle ∓ the half chord turned a quarter: x = (fx + tx)/2 - turn·(fy - ty)/2, y = (fy + ty)/2 + turn·(fx - tx)/2.
                const bx = combineExpressions([
                    [0.5, fx],
                    [0.5, tx],
                    [-turn / 2, fy],
                    [turn / 2, ty],
                  ]),
                  by = combineExpressions([
                    [0.5, fy],
                    [0.5, ty],
                    [turn / 2, fx],
                    [-turn / 2, tx],
                  ]);
                const between: LenXy = bx !== undefined && by !== undefined ? [bx, by] : [top.x, top.y];
                // Each half is a quarter turn, so the short way round.
                const quarter = { ...how, large: false };
                edit.arcTo(between, quarter);
                return edit.arcTo(to, quarter);
              }
            }
            const end = arrive(to, target);
            const chord = { x: end.x - from.x, y: end.y - from.y },
              length = Math.hypot(chord.x, chord.y);
            let center: P, clockwise: boolean;
            if ('tangent' in how) {
              if (!heading) fail('A tangent arc needs a segment before it to carry on from.');
              const normal = left(heading!);
              const across = normal.x * chord.x + normal.y * chord.y;
              if (Math.abs(across) < 1e-9 * length) fail(`${to.join(', ')} is straight ahead: use lineTo.`);
              // The center lies on the normal at the start, as far from the end as from the start.
              const k = (length * length) / (2 * across);
              center = { x: from.x + normal.x * k, y: from.y + normal.y * k };
              clockwise = k < 0;
            } else {
              const r = measure(how.r, 'Radius');
              if (!(r >= length / 2 - 1e-9))
                fail(`A ${r} mm radius can't reach ${to.join(', ')}: it needs at least ${+(length / 2).toFixed(3)} mm.`);
              clockwise = !!how.clockwise;
              const rise = Math.sqrt(Math.max(0, r * r - (length * length) / 4));
              // The short way round, the center lies on the side the arc turns towards.
              const side = (clockwise ? -1 : 1) * (how.large ? -1 : 1);
              const normal = left(unit(chord));
              center = { x: from.x + chord.x / 2 + side * normal.x * rise, y: from.y + chord.y / 2 + side * normal.y * rise };
            }
            const radius = Math.hypot(from.x - center.x, from.y - center.y);
            const angle = (p: P) => Math.atan2(p.y - center.y, p.x - center.x);
            // Arcs run counterclockwise, so a clockwise one is drawn from its end.
            const [a, b] = clockwise ? [end, from] : [from, end];
            const made = added(sketch => addArc(sketch, { cx: center.x, cy: center.y, radius, startAngle: angle(a), endAngle: angle(b) }));
            const arc = made.find(e => e.type === 'arc')!;
            // Two arcs of an S-curve can share a center. One point for both would tie them twice over, so each gets its own.
            if (!made.some(e => e.id === arc.centerId)) {
              const own = { id: newCadId(), type: 'point' as const, x: center.x, y: center.y };
              apply(sketch => ({
                ...sketch,
                entities: [...sketch.entities.map(e => (e.id === arc.id ? { ...arc, centerId: own.id } : e)), own],
              }));
            }
            const previous = edges.at(-1);
            edges.push({ id: arc.id });
            if ('tangent' in how) self.relate('tangent', previous!, { id: arc.id });
            else constrain({ type: 'radius', entityId: arc.id, value: radius, ...expressionOf(how.r) });
            const out = { x: end.x - center.x, y: end.y - center.y };
            heading = unit(clockwise ? { x: out.y, y: -out.x } : left(out));
            cursor = end;
            cursorTyped = to;
            return edit;
          },
          cubicTo(to, { control1, control2 }) {
            open();
            const source = cursorTyped;
            const end = arrive(to, at(to));
            const curve = curves.pathBezier([source, control1, control2, to]);
            edges.push({ id: curve.id });
            const control = at(control2);
            heading = unit({ x: end.x - control.x, y: end.y - control.y });
            cursor = end;
            cursorTyped = to;
            return edit;
          },
          quadTo(to, { control }) {
            open();
            const source = cursorTyped;
            const end = arrive(to, at(to));
            const curve = curves.pathBezier([source, control, to]);
            edges.push({ id: curve.id });
            const handle = at(control);
            heading = unit({ x: end.x - handle.x, y: end.y - handle.y });
            cursor = end;
            cursorTyped = to;
            return edit;
          },
          close(options) {
            open();
            if (Math.hypot(cursor.x - start.x, cursor.y - start.y) > 1e-6) {
              if (!options?.straight)
                closures.push({ partId, sketchId, edgeId: edges[0]!.id, from: [cursor.x, cursor.y], to: [start.x, start.y] });
              edit.lineTo(from);
            }
            closed = true;
            const corners = vertices.map(vertex => {
              const point: CadRef & { fixed?: boolean } = pointNear([vertex.at.x, vertex.at.y]);
              return point.fixed && typed(vertex.typed)
                ? detach(
                    point.id,
                    edges.map(edge => edge.id)
                  )
                : point;
            });
            // Dimensioned as a person would: the start is placed, and each corner is measured from the one before, a
            // straight edge along an axis by its length alone. Changing one length then moves what comes after it.
            const first = corners[0]!;
            if (!('fixed' in first && first.fixed) && !isPlaced(first.id)) place(first, vertices[0]!.typed);
            vertices.slice(1).forEach((vertex, i) => {
              const a = corners[i]!,
                b = corners[i + 1]!;
              // The fixed origin is placed already.
              if (isPlaced(b.id) || ('fixed' in b && b.fixed)) return;
              const before = vertices[i]!;
              const edge = edges[i]!,
                straight = current().entities.find(e => e.id === edge.id)?.type === 'line';
              (['x', 'y'] as const).forEach((axis, k) => {
                const delta = vertex.at[axis] - before.at[axis];
                // Along an axis only when it always is: two sizes that are equal now may not stay so.
                if (differenceExpression(before.typed[k]!, vertex.typed[k]!) === 0) {
                  const along = axis === 'x' ? 'vertical' : 'horizontal';
                  if (straight) constrain({ type: along, entityId: edge.id });
                  else constrain({ type: `${along}Points`, pointAId: a.id, pointBId: b.id });
                  return;
                }
                // Dimensions read positive, from the lower point to the higher.
                const [low, high] = delta > 0 ? [before.typed[k]!, vertex.typed[k]!] : [vertex.typed[k]!, before.typed[k]!];
                const [lowPoint, highPoint] = delta > 0 ? [a, b] : [b, a];
                // Written so the model reads it back as this length; units decide which way, so both are tried.
                const length = ['', 'mm']
                  .map(unit => differenceExpression(low, high, unit))
                  .find(candidate => {
                    if (typeof candidate === 'number') return true;
                    const read = parseCadValue(candidate, { unit: 'mm', variables: cadVariableScope(document) });
                    return !('error' in read) && Math.abs(read.value - Math.abs(delta)) < 1e-6 * Math.max(1, Math.abs(delta));
                  });
                if (length === undefined) {
                  // Nothing reads back right, so this corner keeps its own position, which still follows the variables.
                  constrain({
                    type: axis === 'x' ? 'positionX' : 'positionY',
                    pointId: b.id,
                    value: vertex.at[axis],
                    label: axis === 'x' ? 'X' : 'Y',
                    ...expressionOf(vertex.typed[k]!),
                  });
                  return;
                }
                constrain({
                  type: axis === 'x' ? 'distanceX' : 'distanceY',
                  pointAId: lowPoint.id,
                  pointBId: highPoint.id,
                  value: Math.abs(delta),
                  label: axis === 'x' ? 'Width' : 'Height',
                  ...expressionOf(length),
                });
              });
            });
            return { edges, corners };
          },
        };
        return edit;
      },
      line(from, to) {
        const line = added(sketch => addLine(sketch, { x1: from[0], y1: from[1], x2: to[0], y2: to[1] })).find(e => e.type === 'line')!;
        return { id: line.id, start: { id: line.startId }, end: { id: line.endId } };
      },
      arc({ at: [cx, cy], r, from, to }) {
        const rad = Math.PI / 180;
        const arc = added(sketch => addArc(sketch, { cx, cy, radius: r, startAngle: from * rad, endAngle: to * rad })).find(
          e => e.type === 'arc'
        )!;
        return { id: arc.id, center: { id: arc.centerId }, start: { id: arc.startId }, end: { id: arc.endId } };
      },
      fillet(corners, r) {
        const result = filletLineCorners(current(), { cornerPointIds: corners.map(corner => corner.id), radius: measure(r, 'Radius') });
        if (!result.ok)
          return fail(
            `${result.message}${result.maximumRadius === undefined ? '' : ` The largest radius that fits is ${+result.maximumRadius.toFixed(3)} mm.`}`
          );
        const before = new Set(current().constraints.map(c => c.id));
        // The fillet's one radius dimension carries the expression; its other arcs are equal to it.
        apply(() => ({
          ...result.sketch,
          constraints: result.sketch.constraints.map(c => (before.has(c.id) || c.type !== 'radius' ? c : { ...c, ...expressionOf(r) })),
        }));
        return result.arcIds.map(id => ({ id }));
      },
      relate(relation, ...items) {
        const result = buildConstraintForSelection(
          current(),
          relation,
          items.map(item => item.id)
        );
        if (result.alreadyApplied) return;
        const constraints = result.constraints ?? (result.constraint ? [result.constraint] : []);
        if (!constraints.length) fail(result.message);
        apply(sketch => constraints.reduce((next, constraint) => addConstraint(next, constraint), sketch));
      },
      distance(a, b, value, axis) {
        const type = axis === 'x' ? 'distanceX' : axis === 'y' ? 'distanceY' : 'distance';
        constrain({ type, pointAId: a.id, pointBId: b.id, value: measure(value, 'Distance'), ...expressionOf(value) });
      },
      radius(curve, value) {
        constrain({ type: 'radius', entityId: curve.id, value: measure(value, 'Radius'), ...expressionOf(value) });
      },
      place,
      pattern(items, { count, step, rows }) {
        const counted = (value: Len) => Math.floor(measure(value, 'Count', 'scalar') + 1e-9);
        const stepped = (value: LenXy) => {
          const [x, y] = [measure(value[0], 'Step x'), measure(value[1], 'Step y')];
          const written = value.filter((part): part is string => typeof part === 'string');
          // The model keeps a step's direction and lets an expression set its length, so only one axis can carry it.
          if (written.length && (written.length > 1 || (x !== 0 && y !== 0)))
            fail(`A step that follows variables runs along one axis, such as [0, 'pitch'], not [${value.join(', ')}].`);
          // A spacing is a length: a step written `-pitch` runs backwards a pitch at a time.
          const length = x + y;
          return { vector: { x, y }, ...(written[0] && { spacing: length < 0 ? `-(${written[0]})` : written[0] }) };
        };
        const along = stepped(step),
          across = rows && stepped(rows.step);
        const expressions = {
          ...(typeof count === 'string' && { countX: count }),
          ...(along.spacing && { spacingX: along.spacing }),
          ...(typeof rows?.count === 'string' && { countY: rows.count }),
          ...(across?.spacing && { spacingY: across.spacing }),
        };
        const result = linearPatternSketchEntities(current(), {
          // A rectangle or path counts as its edges.
          entityIds: items.flatMap(item => ('edges' in item ? Object.values(item.edges).map(edge => edge.id) : [item.id])),
          countX: counted(count),
          stepX: along.vector,
          ...(rows && { countY: counted(rows.count), stepY: across!.vector }),
          ...(Object.keys(expressions).length && { expressions }),
        });
        if (!result.ok) return fail(result.message);
        apply(() => result.sketch);
      },
      find: handle => ({
        id: resolveHandle(
          current().entities.map(e => e.id),
          handle,
          'entity'
        ),
      }),
      regionAt(x, y) {
        solveForQuery();
        const regions = cadSketchRegions(partOf(partId), sketchId);
        const hits = regions
          .filter(r => pointInPolygon({ x, y }, r.points) && !r.holes.some(hole => pointInPolygon({ x, y }, hole)))
          .sort((a, b) => Math.abs(polygonArea(a.points)) - Math.abs(polygonArea(b.points)));
        if (hits[0]) return { sketchId, regionId: hits[0].id };
        return fail(
          regions.length
            ? `There is no region at ${x}, ${y}. The sketch has ${regions.length} region(s).`
            : `There is no region at ${x}, ${y}. This sketch has no closed regions yet, or the part's outline isn't closed.`
        );
      },
    };
    return self;
  };

  const partEdit = (partId: string): PartEdit => ({
    id: partId,
    name: partOf(partId).name,
    profile: sketchEdit(partId, partOf(partId).sketch.id),
    thickness(mm) {
      const value = measure(mm, 'Thickness');
      if (!(value > 0)) fail(`A part needs a positive thickness, not ${value}.`);
      replacePart(partId, ({ thicknessExpression: _thicknessExpression, ...part }) => ({
        ...part,
        thickness: value,
        ...(typeof mm === 'string' && { thicknessExpression: mm }),
      }));
    },
    relief(diameter) {
      if (diameter === null) {
        replacePart(partId, ({ cornerRelief: _cornerRelief, ...part }) => part);
        return;
      }
      const value = measure(diameter, 'Relief');
      if (!(value > 0)) fail(`Corner relief needs a positive bit diameter, not ${value}.`);
      replacePart(partId, part => ({
        ...part,
        cornerRelief: { diameter: value, ...(typeof diameter === 'string' && { diameterExpression: diameter }) },
      }));
    },
    sketchOn(face) {
      const on: CadFaceRef = typeof face === 'object' ? { floorOf: face.floorOf.id } : face;
      const result = addFaceSketch(document, partId, on);
      document = result.document;
      return sketchEdit(partId, result.sketchId);
    },
    sketch(handle) {
      const ids = cadFaceSketches(partOf(partId)).map(face => face.sketch.id);
      return sketchEdit(partId, resolveHandle(ids, handle, 'face sketch'));
    },
    cut({ sketchId, regionId }, { depth }) {
      const mm = depth === 'through' ? depth : measure(depth, 'Depth');
      if (mm !== 'through' && !(mm > 0))
        fail(`A cut needs some depth, not ${mm} mm${typeof depth === 'string' ? ` from '${depth}'` : ''}.`);
      document = setCutDepth(
        document,
        partId,
        sketchId,
        regionId,
        mm,
        typeof depth === 'string' && depth !== 'through' ? depth : undefined
      );
      const cut = partOf(partId).features!.find(f => f.type === 'cut' && f.sketchId === sketchId && f.regionId === regionId)!;
      return { id: cut.id };
    },
    remove(feature) {
      document = removeCadFeature(document, partId, feature.id);
    },
    existingCut(handle) {
      return existing.cut(partId, handle);
    },
    expect(expectation) {
      expectations.set(partId, [...(expectations.get(partId) ?? []), expectation]);
    },
    place(options) {
      const placement = placementOf(options);
      replacePart(partId, part => ({ ...part, placement }));
    },
    copy({ mirrored, name, ...options }) {
      const placement = placementOf(options);
      const added = addPartCopy(document, partId, { mirrored });
      document = added.document;
      replacePart(partId, part => ({
        ...part,
        copies: part.copies?.map(copy => (copy.id === added.id ? { ...copy, placement, ...(name && { name }) } : copy)),
      }));
      // Copies placed by hand go ahead of a pattern's, as they will in the design, so names read now stay right.
      document = resolvePartPatterns(document);
      return copyHandle(partId, added.id);
    },
    face(which) {
      solveForQuery();
      if (which === 'top' || which === 'underside') return { partId, face: which };
      const found = cadFaceFacing(document, partId, which);
      return 'error' in found ? fail(found.error) : { partId, face: found.face };
    },
    drawOn(on, { offset = 0, inward } = {}) {
      if (typeof on === 'object' && on.partId === partId) fail(`${partOf(partId).name} can't be drawn on itself.`);
      if (!partOf(partId).sketch.entities.some(e => e.type !== 'point'))
        fail(`Draw ${partOf(partId).name}’s profile before drawing it on a plane or face.`);
      const drawnOn: CadDrawnOn = {
        on: typeof on === 'string' ? { plane: on } : { partId: on.partId, face: on.face },
        offset: measure(offset, 'Offset'),
        ...(typeof offset === 'string' && { offsetExpression: offset }),
        ...(inward && { inward: true }),
      };
      replacePart(partId, part => ({ ...part, drawnOn }));
      // Placed now, so a face of this part can be picked by the way it looks.
      document = resolveDrawnPlacements(document, evaluateCadDocument(document).parts).document;
    },
    pattern({ axis, count, spacing }) {
      if (partOf(partId).pattern?.circular)
        fail(
          'This part has a circular pattern. Edit its count with d.step(...).set({ count }), or removePattern before creating a linear pattern.'
        );
      const total = Math.floor(measure(count, 'Count', 'scalar') + 1e-9);
      if (!(total >= 1)) fail(`A part pattern needs at least one part, not ${total}.`);
      if (total > CAD_MAX_PART_PATTERN) fail(`A part pattern makes at most ${CAD_MAX_PART_PATTERN} parts, not ${total}.`);
      document = setPartPattern(document, partId, {
        axis,
        count: total,
        spacing: measure(spacing, 'Spacing'),
        ...(typeof count === 'string' && { countExpression: count }),
        ...(typeof spacing === 'string' && { spacingExpression: spacing }),
      });
      // A pattern of one makes no copies, and the part may have none.
      return (partOf(partId).copies ?? []).filter(copy => copy.pattern).map(copy => copyHandle(partId, copy.id));
    },
  });

  const existing = existingDesignEdit({
    get: () => document,
    set: next => {
      document = next;
    },
    part: partEdit,
    copy: copyHandle,
    measure,
  });
  const optionsOnPart = (partId: string, options?: { thickness?: Len; relief?: Len }) => {
    const edit = partEdit(partId);
    if (options?.thickness !== undefined) edit.thickness(options.thickness);
    if (options?.relief !== undefined) edit.relief(options.relief);
    return edit;
  };
  const { findPart: _findPart, cut: _cut, ...existingApi } = existing;
  const edit: DesignEdit = {
    folder(name, script) {
      return runFolderScope(
        {
          get: () => document,
          set: next => {
            document = next;
            variablesDirty = true;
          },
        },
        edit,
        name,
        script
      );
    },
    existingFolder(name, script) {
      return runFolderScope(
        {
          get: () => document,
          set: next => {
            document = next;
            variablesDirty = true;
          },
        },
        edit,
        name,
        script,
        true
      );
    },
    ...existingApi,
    part(name, options) {
      return optionsOnPart(existing.findPart(name).id, options);
    },
    newPart(name, options) {
      if (!name.trim()) return fail('A new part needs a name.');
      if (document.parts.some(part => part.name === name)) return fail(`There is already a part named ${name}. Use part() to edit it.`);
      const part = { ...createCadPart(name, 18), id: newCadId() };
      document = { ...document, parts: [...document.parts, part] };
      return optionsOnPart(part.id, options);
    },
    variable(name, expression) {
      const existing = document.variables?.find(variable => variable.name === name);
      const result = setCadVariable(document, { id: existing?.id, name, expression });
      if ('error' in result) return fail(`The variable ${name}: ${result.error}`);
      document = resolvePartPatterns(result.document);
      variablesDirty = true;
      return name;
    },
    cutParts(targets, { with: tools, clearance = 0, split }) {
      const ids = (parts: PartEdit | PartCopy | readonly (PartEdit | PartCopy)[]) =>
        'id' in parts ? [parts.id] : parts.map(part => part.id);
      const value = measure(clearance, 'Clearance');
      if (value < 0) fail(`A clearance can't be negative: ${value} mm.`);
      const fingers = typeof split === 'object' ? measure(split.fingers, 'Fingers', 'scalar') : undefined;
      if (fingers !== undefined && !(Number.isInteger(fingers) && fingers >= 2))
        fail(`A finger joint needs a whole number of fingers, at least 2, not ${fingers}.`);
      document = addPartCut(
        document,
        ids(tools),
        ids(targets),
        { value, ...(typeof clearance === 'string' && { expression: clearance }) },
        typeof split === 'object'
          ? { fingers: fingers!, ...(typeof split.fingers === 'string' && { fingersExpression: split.fingers }) }
          : split
      ).document;
    },
    value(expression) {
      // A count or ratio, such as `'(height - 2*margin)/pitch'`, has no unit.
      if (
        typeof expression === 'string' &&
        !('error' in parseCadValue(expression, { unit: 'scalar', variables: cadVariableScope(document) }))
      )
        return measure(expression, 'Value', 'scalar');
      return measure(expression, 'Value');
    },
  };
  return {
    edit,
    document: () => document,
    closures,
  };
}

export interface CadEditResult {
  ok: boolean;
  document: CadDocument;
  report: CadReport;
  /** The finished parts, for drawing. */
  parts: EvaluatedCadPart[];
  /** Why the script stopped. The design is then returned as it was before the script. */
  scriptError?: string;
}

/**
 * Runs a script against a design, or a new one, then solves and reports on the result. The output is an ordinary
 * document and the script isn't kept, so hand edits later have nothing to fight with.
 */
export async function editCad(
  start: CadDocument | null,
  script: CadScript,
  options: { name?: string; toolpaths?: boolean } = {}
): Promise<CadEditResult> {
  const base = start ?? createCadDocument(options.name);
  await initializeCadSolver();
  const expectations = new Map<string, CadExpectation[]>();
  const session = createDesignEdit(base, expectations);
  let scriptError: string | undefined;
  try {
    script(checkedDesignApi(session.edit));
  } catch (error) {
    if (!(error instanceof CadScriptError)) throw error;
    scriptError = error.message;
  }
  // A failed script leaves the design as it was: half of an intent is worse than none of it.
  const edited = scriptError ? base : { ...session.document(), revision: base.revision + 1 };
  const inspected = await inspectCadDocument(edited, expectations, { toolpaths: options.toolpaths });
  if (!scriptError)
    for (const closure of session.closures) {
      const part = inspected.document.parts.find(part => part.id === closure.partId);
      const sketch =
        part && [part.sketch, ...cadFaceSketches(part).map(face => face.sketch)].find(sketch => sketch.id === closure.sketchId);
      if (!sketch?.entities.some(entity => entity.id === closure.edgeId)) continue;
      const ref = shortHandles(sketch.entities.map(entity => entity.id)).get(closure.edgeId)!;
      inspected.report.warnings.push({
        code: 'close-straight',
        part: part!.name,
        entities: [ref],
        message: `Path ${ref}: close() adds a straight edge from ${closure.from.join(', ')} to ${closure.to.join(', ')}. Use close({ straight: true }) if intended.`,
      });
    }
  // A new design that failed is empty, and saying so would only hide the script's error.
  if (scriptError && !base.parts.length) inspected.report.errors = inspected.report.errors.filter(error => error.code !== 'no-parts');
  return { ...inspected, ok: inspected.report.ok && !scriptError, ...(scriptError && { scriptError }) };
}
