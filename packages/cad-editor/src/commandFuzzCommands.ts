import {
  addArc,
  addCircle,
  addConstraint,
  addLine,
  addPartCopy,
  chamferLineCorners,
  circularPatternSketchEntities,
  dimensionForSelection,
  filletLineCorners,
  linearPatternSketchEntities,
  mirrorSketchEntities,
  newCadId,
  newExtrudeOf,
  offsetSketch,
  prepareDimensionCreation,
  removeCadFeature,
  removeConstraint,
  removeEntity,
  resolveFilletCorners,
  setDimensionDriven,
  setPartPattern,
  solveCadDocument,
  updateDimension,
  withDimensionPlacement,
  type CadDocument,
  type CadEntity,
  type CadPart,
  type CadPoint,
  type CadSketch,
} from '@wbcnc/cad';
import type { FuzzRandom } from '@wbcnc/cad/fuzz';
import { buildConstraintForSelection, type ConstraintCommandTool } from './constraintCommands';
import { createRectangle } from './rectangleTool';
import { trimSketchCurveAt } from './trimCurves';

/** A command's result: the next document, or the editor's refusal for the current state. */
export type FuzzOutcome = { document: CadDocument; note?: string } | { refused: string };
export interface FuzzCommand {
  name: string;
  /** How often it's picked relative to the others; 1 by default. */
  weight?: number;
  run(random: FuzzRandom, document: CadDocument): FuzzOutcome | Promise<FuzzOutcome>;
}

/** A sketch the editor can change: a part's own sketch, or a face sketch that a Remove step doesn't own. */
interface SketchTarget {
  part: CadPart;
  sketch: CadSketch;
  label: string;
  replace(document: CadDocument, sketch: CadSketch): CadDocument;
}

function sketchTargets(document: CadDocument): SketchTarget[] {
  return document.parts.flatMap((part, p): SketchTarget[] => {
    if (part.sketchOf) return [];
    const withPart = (document: CadDocument, edit: (part: CadPart) => CadPart) => ({
      ...document,
      parts: document.parts.map(other => (other.id === part.id ? edit(structuredClone(other)) : other)),
    });
    return [
      { part, sketch: part.sketch, label: `part ${p} sketch`, replace: (doc, sketch) => withPart(doc, owner => ({ ...owner, sketch })) },
      ...(part.features ?? []).flatMap((feature, f): SketchTarget[] =>
        feature.type === 'sketch' && feature.removedBy === undefined
          ? [
              {
                part: { ...part, sketch: feature.sketch, features: undefined },
                sketch: feature.sketch,
                label: `part ${p} face sketch ${f}`,
                replace: (doc, sketch) =>
                  withPart(doc, owner => ({
                    ...owner,
                    features: owner.features!.map(other => (other.id === feature.id ? { ...other, sketch } : other)),
                  })),
              },
            ]
          : []
      ),
    ];
  });
}

const refused = (reason: string): FuzzOutcome => ({ refused: reason });
const ofType = (sketch: CadSketch, ...types: CadEntity['type'][]) =>
  sketch.entities.filter(entity => types.includes(entity.type) && !entity.faceEdge);
const ids = (entities: readonly CadEntity[]) => entities.map(entity => entity.id);
const describeIds = (sketch: CadSketch, selected: readonly string[]) =>
  selected.map(id => {
    const index = sketch.entities.findIndex(entity => entity.id === id);
    return index < 0 ? id : `${sketch.entities[index]!.type}#${index}`;
  });

/** A spot near the sketch's geometry: sometimes exactly on a point, so new shapes join the old. */
function spot(random: FuzzRandom, sketch: CadSketch): CadPoint {
  const points = ofType(sketch, 'point').filter(point => point.type === 'point');
  if (points.length && random.chance(0.3)) {
    const point = random.pick(points);
    if (point.type === 'point') return { x: point.x, y: point.y };
  }
  const xs = points.map(point => (point.type === 'point' ? point.x : 0));
  const ys = points.map(point => (point.type === 'point' ? point.y : 0));
  const [minX, maxX, minY, maxY] = xs.length ? [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)] : [0, 100, 0, 100];
  return { x: Math.round(random.range(minX - 30, maxX + 30)), y: Math.round(random.range(minY - 30, maxY + 30)) };
}

type SketchEdit = FuzzOutcome | CadSketch | { sketch: CadSketch; note: string };

/** Runs `edit` on a random editable sketch and puts the result back. */
function inSketch(
  name: string,
  weight: number,
  edit: (random: FuzzRandom, target: SketchTarget, document: CadDocument) => SketchEdit | Promise<SketchEdit>
): FuzzCommand {
  return {
    name,
    weight,
    async run(random, document) {
      const targets = sketchTargets(document);
      if (!targets.length) return refused('no editable sketch');
      const target = random.pick(targets);
      const result = await edit(random, target, document);
      if ('entities' in result) return { document: target.replace(document, result), note: target.label };
      if ('sketch' in result) return { document: target.replace(document, result.sketch), note: `${target.label}: ${result.note}` };
      if ('refused' in result) return refused(`${target.label}: ${result.refused}`);
      return { ...result, note: `${target.label}${result.note ? `: ${result.note}` : ''}` };
    },
  };
}

const CONSTRAINT_TOOLS: readonly ConstraintCommandTool[] = [
  'horizontal',
  'vertical',
  'coincident',
  'concentric',
  'symmetric',
  'midpoint',
  'parallel',
  'perpendicular',
  'equal',
  'tangent',
];

/** Some selection of 1–`max` entities of any kind. */
function selection(random: FuzzRandom, sketch: CadSketch, max = 3): string[] {
  const candidates = ofType(sketch, 'point', 'line', 'circle', 'arc', 'ellipse', 'conic', 'bezier', 'spline');
  return ids(random.sample(candidates, 1 + random.int(max)));
}

/** Mostly the kinds of entities a constraint tool takes, so most picks make a relation; sometimes any. */
function constraintSelection(random: FuzzRandom, sketch: CadSketch, tool: ConstraintCommandTool): string[] {
  if (random.chance(0.25)) return selection(random, sketch);
  const take = (count: number, ...types: CadEntity['type'][]) => ids(random.sample(ofType(sketch, ...types), count));
  const curves = ['line', 'circle', 'arc'] as const;
  switch (tool) {
    case 'horizontal':
    case 'vertical':
      return random.chance(0.6) ? take(1, 'line') : take(2, 'point');
    case 'parallel':
    case 'perpendicular':
      return take(2, 'line');
    case 'coincident':
      return random.chance(0.5) ? take(2, 'point') : [...take(1, 'point'), ...take(1, ...curves)];
    case 'concentric':
      return take(2, 'circle', 'arc');
    case 'midpoint':
      return [...take(1, 'point'), ...take(1, 'line')];
    case 'symmetric':
      return [...take(1, 'line'), ...take(2, 'point')];
    case 'equal':
      return random.chance(0.5) ? take(2, 'line') : take(2, 'circle', 'arc');
    case 'tangent':
      return [...take(1, 'line', 'arc'), ...take(1, 'circle', 'arc')];
  }
}

/** A corner where two lines meet, for fillet and chamfer; sometimes anything. */
function cornerSelection(random: FuzzRandom, sketch: CadSketch): string[] {
  const ends = ofType(sketch, 'line').flatMap(line => (line.type === 'line' ? [line.startId, line.endId] : []));
  const shared = [...new Set(ends.filter((id, i) => ends.indexOf(id) !== i))];
  return shared.length && random.chance(0.8) ? random.sample(shared, 1 + random.int(2)) : selection(random, sketch, 2);
}

/** The editor's commands, each choosing its own inputs from the current document. */
export const FUZZ_COMMANDS: readonly FuzzCommand[] = [
  inSketch('draw line', 4, (random, { sketch }) => {
    const [a, b] = [spot(random, sketch), spot(random, sketch)];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1) return refused('zero-length line');
    return addLine(sketch, { x1: a.x, y1: a.y, x2: b.x, y2: b.y, construction: random.chance(0.1) });
  }),
  inSketch('draw rectangle', 3, (random, { sketch }) => {
    const start = spot(random, sketch);
    const typed = random.chance(0.3);
    const size = () => random.pick(['20', '35.5', '0', '-4', 'abc', '10 + 5', `${random.int(80)}`]);
    const result = createRectangle(sketch, {
      tool: random.chance(0.5) ? 'rectangle' : 'centerRectangle',
      start,
      ...(typed ? { width: size(), height: size() } : { end: spot(random, sketch) }),
    });
    return result.error !== undefined ? refused(result.error) : result.sketch;
  }),
  inSketch('draw circle', 3, (random, { sketch }) => {
    const center = spot(random, sketch);
    return addCircle(sketch, { ...center, radius: 1 + random.int(40), dimensioned: random.chance(0.3) });
  }),
  inSketch('draw arc', 3, (random, { sketch }) => {
    const center = spot(random, sketch);
    const startAngle = random.range(0, 2 * Math.PI);
    return addArc(sketch, {
      cx: center.x,
      cy: center.y,
      radius: 2 + random.int(40),
      startAngle,
      endAngle: startAngle + random.range(0.3, 5),
    });
  }),
  inSketch('constrain', 4, (random, { sketch }) => {
    const tool = random.pick(CONSTRAINT_TOOLS);
    const selected = constraintSelection(random, sketch, tool);
    const result = buildConstraintForSelection(sketch, tool, selected);
    const constraints = result.constraints ?? (result.constraint ? [result.constraint] : []);
    const what = `${tool} ${describeIds(sketch, selected).join(', ')}`;
    if (result.needsMore || result.alreadyApplied || !constraints.length) return refused(`${what}: ${result.message}`);
    return { sketch: constraints.reduce(addConstraint, sketch), note: what };
  }),
  inSketch('dimension', 3, async (random, target) => {
    const { sketch, part } = target;
    const selected = selection(random, sketch, 2);
    const at = spot(random, sketch);
    const picked = dimensionForSelection(sketch, selected, {
      mode: random.pick(['auto', 'auto', 'distance', 'distanceX', 'distanceY', 'angle'] as const),
      placement: at,
    });
    const what = describeIds(sketch, selected).join(', ');
    if (!('constraint' in picked)) return refused(`${what}: ${picked.message}`);
    if (picked.existingConstraintId) return refused(`${what}: already dimensioned`);
    const dimension = withDimensionPlacement(sketch, { ...picked.constraint, id: newCadId() }, at);
    const result = await prepareDimensionCreation({ ...part, sketch }, dimension);
    return result.ok ? result.part.sketch : refused(`${what}: ${result.message}`);
  }),
  {
    name: 'edit dimension',
    run(random, document) {
      const dimensions = document.parts.flatMap(part => part.sketch.constraints.filter(c => 'value' in c && !c.driven));
      if (!dimensions.length) return refused('no driving dimension');
      const dimension = random.pick(dimensions) as { id: string; value: number };
      const value = dimension.value * random.pick([0.5, 0.9, 1.1, 2, -1]);
      return { document: updateDimension(document, dimension.id, value), note: `${dimension.id} ${dimension.value} -> ${value}` };
    },
  },
  {
    name: 'toggle driven',
    run(random, document) {
      const dimensions = document.parts.flatMap(part => part.sketch.constraints.filter(c => 'value' in c));
      if (!dimensions.length) return refused('no dimension');
      const dimension = random.pick(dimensions) as { id: string; driven?: boolean };
      return { document: setDimensionDriven(document, dimension.id, !dimension.driven), note: dimension.id };
    },
  },
  inSketch('delete', 2, (random, { sketch }) => {
    if (random.chance(0.6) && sketch.entities.length > 1) {
      const entity = random.pick(sketch.entities);
      return removeEntity(sketch, entity.id);
    }
    if (!sketch.constraints.length) return refused('nothing to delete');
    return removeConstraint(sketch, random.pick(sketch.constraints).id);
  }),
  inSketch('fillet', 1, (random, { sketch }) => {
    const corners = resolveFilletCorners(sketch, cornerSelection(random, sketch));
    if (!corners.ok) return refused(corners.message);
    const result = filletLineCorners(sketch, { cornerPointIds: corners.cornerPointIds, radius: random.pick([1, 3, 8, 50]) });
    return result.ok ? result.sketch : refused(result.message);
  }),
  inSketch('chamfer', 1, (random, { sketch }) => {
    const corners = resolveFilletCorners(sketch, cornerSelection(random, sketch));
    if (!corners.ok) return refused(corners.message);
    const distance = random.pick([1, 4, 30]);
    const result = chamferLineCorners(sketch, { cornerPointIds: corners.cornerPointIds, distanceA: distance, distanceB: distance });
    return result.ok ? result.sketch : refused(result.message);
  }),
  inSketch('mirror', 1, (random, { sketch }) => {
    const lines = ofType(sketch, 'line');
    if (!lines.length) return refused('no mirror line');
    const result = mirrorSketchEntities(sketch, { axisId: random.pick(lines).id, entityIds: selection(random, sketch) });
    return result.ok ? result.sketch : refused(result.message);
  }),
  inSketch('offset', 1, (random, { sketch }) => {
    const curves = ofType(sketch, 'line', 'circle', 'arc');
    const result = offsetSketch(sketch, {
      entityIds: ids(random.sample(curves, 1 + random.int(2))),
      value: random.pick([-5, -1, 2, 6, 0]),
      wholeLoop: random.chance(0.5),
    });
    return result.ok ? result.sketch : refused(result.message);
  }),
  inSketch('linear pattern', 1, (random, { sketch }) => {
    const result = linearPatternSketchEntities(sketch, {
      entityIds: selection(random, sketch),
      countX: 1 + random.int(4),
      countY: 1 + random.int(3),
      stepX: { x: random.pick([15, 40, -25]), y: 0 },
      stepY: { x: 0, y: random.pick([15, 30]) },
    });
    return result.ok ? result.sketch : refused(result.message);
  }),
  inSketch('circular pattern', 1, (random, { sketch }) => {
    const result = circularPatternSketchEntities(sketch, {
      entityIds: selection(random, sketch),
      count: 2 + random.int(5),
      angle: random.pick([90, 180, 360]),
      closed: random.chance(0.5),
      center: spot(random, sketch),
    });
    return result.ok ? result.sketch : refused(result.message);
  }),
  inSketch('trim', 1, (random, { sketch }) => {
    const curves = ofType(sketch, 'line', 'circle', 'arc');
    if (!curves.length) return refused('no curve');
    const curve = random.pick(curves);
    return trimSketchCurveAt(sketch, curve.id, spot(random, sketch)) ?? refused('nothing to trim there');
  }),
  inSketch('drag', 1, async (random, target, document) => {
    const points = ofType(target.sketch, 'point').filter(point => point.type === 'point' && !point.fixed);
    if (!points.length) return refused('no free point');
    const point = random.pick(points);
    const to = spot(random, target.sketch);
    const result = await solveCadDocument(document, { drag: { pointId: point.id, ...to } });
    if (result.status !== 'solved') return refused(`drag does not solve: ${result.status}`);
    return { document: result.document, note: `${point.id} to ${to.x}, ${to.y}` };
  }),
  {
    name: 'extrude depth',
    run(random, document) {
      if (!document.parts.length) return refused('no part');
      const index = random.int(document.parts.length);
      const thickness = random.pick([3, 12, 18, 40]);
      const parts = document.parts.map((part, i) => (i === index ? { ...part, thickness, thicknessExpression: undefined } : part));
      return { document: { ...document, parts: JSON.parse(JSON.stringify(parts)) }, note: `part ${index} -> ${thickness}` };
    },
  },
  {
    name: 'new extrude',
    run(random, document) {
      const owners = document.parts.filter(part => !part.sketchOf);
      if (!owners.length) return refused('no part');
      const part = newExtrudeOf(document, random.pick(owners), `Extrude ${document.parts.length + 1}`);
      if (!part.regions?.length) return refused('no unused regions');
      return { document: { ...document, parts: [...document.parts, part] } };
    },
  },
  {
    name: 'part pattern',
    run(random, document) {
      if (!document.parts.length) return refused('no part');
      const part = random.pick(document.parts);
      const pattern = random.chance(0.2)
        ? null
        : { axis: random.pick(['x', 'y', 'z'] as const), count: 1 + random.int(4), spacing: random.pick([-60, 25, 150]) };
      return { document: setPartPattern(document, part.id, pattern), note: JSON.stringify(pattern) };
    },
  },
  {
    name: 'part copy',
    run(random, document) {
      if (!document.parts.length) return refused('no part');
      const part = random.pick(document.parts);
      return {
        document: addPartCopy(document, part.id, {
          mirrored: random.chance(0.5),
          offset: { position: [random.int(200), 0, 0], rotation: [0, 0, 0, 1] },
        }).document,
      };
    },
  },
  {
    name: 'remove feature',
    run(random, document) {
      const features = document.parts.flatMap(part => (part.features ?? []).map(feature => [part, feature] as const));
      if (!features.length) return refused('no feature');
      const [part, feature] = random.pick(features);
      return { document: removeCadFeature(document, part.id, feature.id), note: `${feature.type} ${feature.id}` };
    },
  },
];
