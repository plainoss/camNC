import { buildConstraintForSelection, type ConstraintCommandTool } from '@wbcnc/cad-editor/constraintCommands';
import {
  addArc,
  addCircle,
  addConstraint,
  addFaceSketch,
  addLine,
  addRectangle,
  cadFaceSketches,
  cadSketchRegions,
  createCadDocument,
  createCadPart,
  filletLineCorners,
  newCadId,
  pointInPolygon,
  polygonArea,
  removeCadFeature,
  setCutDepth,
  type CadCutDepth,
  type CadDocument,
  type CadFaceRef,
  type CadPart,
  type CadPointEntity,
  type CadSketch,
  type EvaluatedCadPart,
  type NewCadConstraint,
} from '@wbcnc/cad';
import { inspectCadDocument, type CadExpectation, type CadReport } from './inspect';

export type Xy = readonly [number, number];
/** Anything in a sketch: returned when it's made, or looked up with `find` from a handle in the report. */
export interface CadRef {
  id: string;
}
export interface CadRegionRef {
  sketchId: string;
  regionId: string;
}
export interface CadCutRef {
  id: string;
}
export type CadFacePick = 'top' | 'underside' | { floorOf: CadCutRef };

export interface SketchEdit {
  readonly id: string;
  /** Dimensioned and placed, so it's fully constrained. `at` is the lower-left corner; use `center` for the middle. */
  rect(options: { w: number; h: number; at?: Xy; center?: Xy }): {
    edges: { bottom: CadRef; right: CadRef; top: CadRef; left: CadRef };
    corners: CadRef[];
  };
  /** Dimensioned and placed, so it's fully constrained. */
  circle(options: { at: Xy; d: number }): CadRef & { center: CadRef };
  /** A closed loop through these points, each placed so the loop is fully constrained. Corners can then be filleted. */
  polygon(points: readonly Xy[]): { edges: CadRef[]; corners: CadRef[] };
  /** A single segment with no dimensions, which leaves it free to be constrained. */
  line(from: Xy, to: Xy): CadRef & { start: CadRef; end: CadRef };
  /** Counterclockwise around `at` from `from` degrees to `to` degrees. */
  arc(options: { at: Xy; r: number; from: number; to: number }): CadRef & { center: CadRef; start: CadRef; end: CadRef };
  /** Rounds corners that join two lines, sharing one radius. */
  fillet(corners: readonly CadRef[], r: number): CadRef[];
  /** A geometric relation between curves or points, under the same rules as the sketch editor's tools. */
  relate(relation: ConstraintCommandTool, ...items: CadRef[]): void;
  distance(a: CadRef, b: CadRef, value: number, axis?: 'x' | 'y'): void;
  radius(curve: CadRef, value: number): void;
  place(point: CadRef, at: Xy): void;
  /** Looks up a handle from the report. */
  find(handle: string): CadRef;
  /** The innermost region at a point, as a click picks it. Resolved now to a stable ID, so solving can't move the pick. */
  regionAt(x: number, y: number): CadRegionRef;
}
export interface PartEdit {
  readonly id: string;
  readonly name: string;
  /** The outline sketch. Its outer loop is the part's shape, and inner loops are through-holes unless given a depth. */
  readonly profile: SketchEdit;
  thickness(mm: number): void;
  sketchOn(face: CadFacePick): SketchEdit;
  /** An existing face sketch, by its handle in the report. */
  sketch(handle: string): SketchEdit;
  cut(region: CadRegionRef, options: { depth: CadCutDepth }): CadCutRef;
  remove(feature: CadCutRef): void;
  /** What this part should measure when finished. A valid design isn't necessarily the one you meant. */
  expect(expectation: CadExpectation): void;
}
export interface DesignEdit {
  /** Finds a part by name, or adds it. New parts are 18 mm thick unless `thickness` says otherwise. */
  part(name: string, options?: { thickness?: number }): PartEdit;
}
export type CadScript = (design: DesignEdit) => void;

/** Identity, so a design file gets the API's types without importing them by hand. */
export const design = (script: CadScript) => script;

class CadScriptError extends Error {}
const fail = (message: string): never => {
  throw new CadScriptError(message);
};

function resolveHandle(ids: readonly string[], handle: string, what: string): string {
  const matches = ids.filter(id => id === handle || id.startsWith(handle));
  if (matches.length === 1) return matches[0]!;
  return fail(
    matches.length ? `The handle ${handle} matches several ${what}. Use more of it.` : `There is no ${what} with the handle ${handle}.`
  );
}

function createDesignEdit(start: CadDocument, expectations: Map<string, CadExpectation[]>) {
  let document = start;
  const replacePart = (partId: string, edit: (part: CadPart) => CadPart) => {
    document = { ...document, parts: document.parts.map(part => (part.id === partId ? edit(part) : part)) };
  };
  const partOf = (partId: string) => document.parts.find(part => part.id === partId)!;
  const sketchOf = (partId: string, sketchId: string): CadSketch => {
    const part = partOf(partId);
    return part.sketch.id === sketchId ? part.sketch : cadFaceSketches(part).find(face => face.sketch.id === sketchId)!.sketch;
  };
  const setSketch = (partId: string, sketchId: string, sketch: CadSketch) =>
    replacePart(partId, part =>
      part.sketch.id === sketchId
        ? { ...part, sketch }
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
    const pointNear = ([x, y]: Xy) =>
      current().entities.find((e): e is CadPointEntity => e.type === 'point' && Math.hypot(e.x - x, e.y - y) < 1e-7)!;
    const isPlaced = (pointId: string) =>
      current().constraints.some(c => (c.type === 'positionX' || c.type === 'positionY') && c.pointId === pointId);
    const place = (point: CadRef, [x, y]: Xy) => {
      constrain({ type: 'positionX', pointId: point.id, value: x, label: 'X' });
      constrain({ type: 'positionY', pointId: point.id, value: y, label: 'Y' });
    };
    return {
      id: sketchId,
      rect({ w, h, at, center }) {
        if (!(w > 0 && h > 0)) fail(`A rectangle needs a positive size, not ${w} × ${h}.`);
        if (!at === !center) fail('A rectangle needs exactly one of at or center.');
        const [x, y] = at ?? [center![0] - w / 2, center![1] - h / 2];
        const made = added(sketch => addRectangle(sketch, { x, y, width: w, height: h, dimensioned: true, positioned: true }));
        const [bottom, right, top, left] = made.filter(e => e.type === 'line');
        const startOf = (edge: (typeof made)[number]) => ({ id: (edge as { startId: string }).startId });
        return { edges: { bottom: bottom!, right: right!, top: top!, left: left! }, corners: [bottom!, right!, top!, left!].map(startOf) };
      },
      circle({ at: [x, y], d }) {
        if (!(d > 0)) fail(`A circle needs a positive diameter, not ${d}.`);
        const circle = added(sketch => addCircle(sketch, { x, y, radius: d / 2, dimensioned: true, positioned: true })).find(
          e => e.type === 'circle'
        )!;
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
        const result = filletLineCorners(current(), { cornerPointIds: corners.map(corner => corner.id), radius: r });
        if (!result.ok)
          return fail(
            `${result.message}${result.maximumRadius === undefined ? '' : ` The largest radius that fits is ${+result.maximumRadius.toFixed(3)} mm.`}`
          );
        apply(() => result.sketch);
        return result.arcIds.map(id => ({ id }));
      },
      relate(relation, ...items) {
        const result = buildConstraintForSelection(
          current(),
          relation,
          items.map(item => item.id)
        );
        if (result.alreadyApplied) return;
        if (!result.constraint) fail(result.message);
        constrain(result.constraint!);
      },
      distance(a, b, value, axis) {
        const type = axis === 'x' ? 'distanceX' : axis === 'y' ? 'distanceY' : 'distance';
        constrain({ type, pointAId: a.id, pointBId: b.id, value });
      },
      radius(curve, value) {
        constrain({ type: 'radius', entityId: curve.id, value });
      },
      place,
      find: handle => ({
        id: resolveHandle(
          current().entities.map(e => e.id),
          handle,
          'entity'
        ),
      }),
      regionAt(x, y) {
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
  };

  const partEdit = (partId: string): PartEdit => ({
    id: partId,
    name: partOf(partId).name,
    profile: sketchEdit(partId, partOf(partId).sketch.id),
    thickness(mm) {
      if (!(mm > 0)) fail(`A part needs a positive thickness, not ${mm}.`);
      replacePart(partId, part => ({ ...part, thickness: mm }));
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
      document = setCutDepth(document, partId, sketchId, regionId, depth);
      const cut = partOf(partId).features!.find(f => f.type === 'cut' && f.sketchId === sketchId && f.regionId === regionId)!;
      return { id: cut.id };
    },
    remove(feature) {
      document = removeCadFeature(document, partId, feature.id);
    },
    expect(expectation) {
      expectations.set(partId, [...(expectations.get(partId) ?? []), expectation]);
    },
  });

  return {
    edit: {
      part(name, options) {
        const existing = document.parts.find(part => part.name === name);
        if (existing) {
          const edit = partEdit(existing.id);
          if (options?.thickness !== undefined) edit.thickness(options.thickness);
          return edit;
        }
        const part = { ...createCadPart(name, options?.thickness ?? 18), id: newCadId() };
        document = { ...document, parts: [...document.parts, part] };
        return partEdit(part.id);
      },
    } satisfies DesignEdit,
    document: () => document,
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
export async function editCad(start: CadDocument | null, script: CadScript, options: { name?: string } = {}): Promise<CadEditResult> {
  const base = start ?? createCadDocument(options.name);
  const expectations = new Map<string, CadExpectation[]>();
  const session = createDesignEdit(base, expectations);
  let scriptError: string | undefined;
  try {
    script(session.edit);
  } catch (error) {
    if (!(error instanceof CadScriptError)) throw error;
    scriptError = error.message;
  }
  // A failed script leaves the design as it was: half of an intent is worse than none of it.
  const edited = scriptError ? base : { ...session.document(), revision: base.revision + 1 };
  const inspected = await inspectCadDocument(edited, expectations);
  return { ...inspected, ok: inspected.report.ok && !scriptError, ...(scriptError && { scriptError }) };
}
