import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addRectangle,
  cadSketchRegions,
  cadVariableScope,
  filletLineCorners,
  linearPatternSketchEntities,
  newCadId,
  parseCadValue,
  pointInPolygon,
  polygonArea,
  type CadDocument,
  type CadPart,
  type CadPointEntity,
  type CadSketch,
  type NewCadConstraint,
} from '@wbcnc/cad';
import { buildConstraintForSelection } from '@wbcnc/cad-editor/constraintCommands';
import { lengthExpression } from './curveExpressions';
import { fitSketchBounds } from './sketchFit';
import { createSketchCurves } from './sketchCurves';
import { combineExpressions, differenceExpression } from './linearExpression';
import { fail, resolveHandle } from './editExisting';
import type { Xy, Len, LenXy, CadRef, SketchEdit, PathEdit } from './editTypes';

/** What a sketch edit reads and writes of the design being edited. */
export type SketchEditContext = {
  document: () => CadDocument;
  partOf: (partId: string) => CadPart;
  sketchOf: (partId: string, sketchId: string) => CadSketch;
  setSketch: (partId: string, sketchId: string, sketch: CadSketch) => void;
  measure: (value: Len, what: string, unit?: 'mm' | 'scalar' | 'deg') => number;
  lengthTerm: (value: Len) => ReturnType<typeof lengthExpression>;
  expressionOf: (value: Len) => { expression?: string };
  solveForQuery: () => void;
  closures: { partId: string; sketchId: string; edgeId: string; from: Xy; to: Xy }[];
};

const minusHalf = (a: Len, b: Len): Len => (typeof a === 'number' && typeof b === 'number' ? a - b / 2 : `(${a}) - (${b})/2`);

/** The script API for drawing on and querying one sketch of a part. */
export function createSketchEdit(context: SketchEditContext, partId: string, sketchId: string): SketchEdit {
  const { partOf, sketchOf, setSketch, measure, lengthTerm, expressionOf, solveForQuery, closures } = context;
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
        sketch => addCircle(sketch, { x: measure(x, 'X'), y: measure(y, 'Y'), radius: diameter / 2, dimensioned: true, positioned: true }),
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
          const line = added(sketch => addLine(sketch, { x1: cursor.x, y1: cursor.y, x2: end.x, y2: end.y })).find(e => e.type === 'line')!;
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
                  const read = parseCadValue(candidate, { unit: 'mm', variables: cadVariableScope(context.document()) });
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
}
