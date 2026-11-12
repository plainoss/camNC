import {
  cadFaceSketches,
  cadVariableProblems,
  cadVariableScope,
  cadSketchRegions,
  patternMaster,
  polygonArea,
  constraintEntityIds,
  parseCadValue,
  assemblyReport,
  cadStepReport,
  cadPartsToCut,
  mirroredPartId,
  pointInPolygon,
  solveCadDocument,
  type CadAssemblyReport,
  type CadStepReportEntry,
  type CadDocument,
  type CadPart,
  type CadPoint,
  type CadSketch,
  type EvaluatedCadPart,
  type EvaluatedCadCut,
  evaluateCadDocument,
  cadCopyName,
  isCadPart,
  activeDesign,
  physicalJoinedCopies,
  smallestCornerRelief,
} from '@wbcnc/cad';
import { checkFurnitureConstruction } from './furnitureJoints';
import { DEFAULT_SETTINGS, DEFAULT_TABS, planBoard, profileFeatures, type BoardRequest, type PlanResult } from '@wbcnc/cam';

import { nativeCurveReport, sketchCurveDetails } from './curveReport';
import { curveExtremaPoints } from './curveBounds';
import { isEdgeNotch } from './notch';

export interface CadExpectation {
  /** Width and height of the outline, in mm. */
  size?: readonly [number | string, number | string];
  thickness?: number | string;
  /** Profile through-holes and explicit through cuts, each pattern copy counted once. */
  holes?: number;
  /** Through cuts that touch or cross the part outline. */
  notches?: number;
  /** Cuts that stop short of going through, each counted on its own however CAM groups them. */
  pockets?: number;
  /** Every cut's floor, in mm below the top or underside, in feature order. */
  depths?: readonly (number | string)[];
  /** Free movement left across all this part's sketches. Use 0 for a fully constrained part. */
  freedom?: number;
  /** mm, default 0.01. */
  tolerance?: number;
}
export interface CadReportIssue {
  code: string;
  message: string;
  part?: string;
  /** Handles of what's involved. */
  entities?: string[];
  /** Where on the part, in its sketch's millimetres, e.g. each corner left square. */
  at?: number[][];
}
export type CadReportEntity =
  | { ref: string; type: 'line'; a: number[]; b: number[]; ends: string[]; construction?: true }
  | { ref: string; type: 'circle'; at: number[]; d: number; construction?: true }
  | { ref: string; type: 'arc'; at: number[]; r: number; a: number[]; b: number[]; ends: string[]; construction?: true }
  | ({ ref: string; type: string; construction?: true } & Partial<ReturnType<typeof nativeCurveReport>>);
export interface CadReportPart {
  name: string;
  thickness: number;
  /** Absent when the outline isn't a valid closed profile. */
  outline?: { at: number[]; size: number[] };
  holes?: number;
  /** Through cuts that touch or cross the part outline. */
  notches?: number;
  /** A cut's box as drawn; `relieved` is its size with the bones in its corners, when they make it bigger. */
  cuts: {
    ref: string;
    side: 'top' | 'underside';
    from: number;
    to: number;
    through: boolean;
    at: number[];
    size: number[];
    relieved?: number[];
  }[];
  sketches: {
    ref: string;
    on: 'profile' | 'top' | 'underside' | { floorOf: string };
    freedom: number | null;
    status: string;
    entities: CadReportEntity[];
    constraints: number;
    patterns?: { ref: string; copies: number }[];
    offsets?: ReturnType<typeof sketchCurveDetails>['offsets'];
    fitting?: ReturnType<typeof sketchCurveDetails>['fitting'];
  }[];
  /** Copy-specific material, in the family's local frame; ordinary copies continue sharing their source. */
  copyFeatures?: { ref: string; name: string; cuts: CadReportPart['cuts'] }[];
  /** Features CAM received. */
  cam?: { pockets: number; throughHoles: number; undersidePockets?: number };
  /** Pieces CAM cuts when the part has copies, by name. Mirrored copies are cut as their own shape. */
  pieces?: { names: string[]; mirrored: string[] };
  /**
   * The part planned alone on a board, as the app plans it, with the default bit and settings and tabs holding it. A
   * summary for checking the design: no program comes out of it, and nothing here says one is safe to run.
   */
  toolpaths?: CadToolpathSummary;
}
export interface CadToolpathSummary {
  bit: number;
  minutes: number;
  operations: { label: string; depth: number; steps: number }[];
  warnings: string[];
  /** What would stop the job in the app: broken safety rules, or something coming loose. */
  blocked: string[];
}
export interface CadReport {
  ok: boolean;
  status: string;
  errors: CadReportIssue[];
  warnings: CadReportIssue[];
  parts: CadReportPart[];
  /** Present when any part is placed. */
  assembly?: CadAssemblyReport;
  /**
   * What each step relating parts refers to and what it came to, in design order: the face a part is drawn on, with that
   * face's frame in words, part patterns, and the openings each "cut parts" step makes.
   */
  steps?: (CadStepReportEntry & { frameInWords?: string })[];
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const xy = (p: CadPoint) => [round(p.x), round(p.y)];
/** Where each arc and circle in a sketch reaches furthest along x and y. */
function curveExtremes(sketch: CadSketch | undefined): CadPoint[] {
  if (!sketch) return [];
  const points = new Map(sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
  return sketch.entities.flatMap(e => {
    if (e.type !== 'circle' && e.type !== 'arc') {
      if (!['bezier', 'spline', 'ellipse', 'conic'].includes(e.type) || e.type === 'point') return [];
      try {
        return curveExtremaPoints(e, points);
      } catch {
        return [];
      }
    }
    const center = points.get(e.centerId);
    if (!center) return [];
    const extremes = [0, 1, 2, 3].map(quarter => ({
      angle: (quarter * Math.PI) / 2,
      x: center.x + e.radius * Math.cos((quarter * Math.PI) / 2),
      y: center.y + e.radius * Math.sin((quarter * Math.PI) / 2),
    }));
    if (e.type === 'circle') return extremes;
    const start = points.get(e.startId),
      end = points.get(e.endId);
    if (!start || !end) return [];
    const turn = (angle: number) => ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    const from = Math.atan2(start.y - center.y, start.x - center.x),
      sweep = turn(Math.atan2(end.y - center.y, end.x - center.x) - from);
    // Arcs run counterclockwise from start to end.
    return extremes.filter(extreme => turn(extreme.angle - from) <= sweep + 1e-9);
  });
}

function distanceToLoop(p: CadPoint, loop: readonly CadPoint[]) {
  return Math.min(
    ...loop.map((a, i) => {
      const b = loop[(i + 1) % loop.length]!,
        dx = b.x - a.x,
        dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
      return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
    })
  );
}

/**
 * A loop's box. Curves are drawn as chords that fall short of them, so the extremes of the curves it was drawn from,
 * which lie within a chord's sag of it, count too.
 */
function bounds(loop: readonly CadPoint[], curves: readonly CadPoint[] = []) {
  const points = [...loop, ...curves.filter(p => distanceToLoop(p, loop) < 0.1)];
  const xs = points.map(p => p.x),
    ys = points.map(p => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return { at: [round(x0), round(y0)], size: [round(x1 - x0), round(y1 - y0)], center: [round((x0 + x1) / 2), round((y0 + y1) / 2)] };
}

/** The shortest prefix of at least 4 characters that names each ID on its own. */
export function shortHandles(ids: readonly string[]): Map<string, string> {
  const handles = new Map<string, string>();
  for (const id of ids) {
    let length = Math.min(4, id.length);
    while (length < id.length && ids.some(other => other !== id && other.startsWith(id.slice(0, length)))) length++;
    handles.set(id, id.slice(0, length));
  }
  return handles;
}

function reportEntities(sketch: CadSketch, handles: ReadonlyMap<string, string>): CadReportEntity[] {
  const ref = (id: string) => handles.get(id)!;
  const points = new Map(sketch.entities.flatMap(e => (e.type === 'point' ? [[e.id, e] as const] : [])));
  const at = (id: string) => xy(points.get(id)!);
  return sketch.entities.flatMap((e): CadReportEntity[] => {
    const flag = e.construction ? ({ construction: true } as const) : {};
    if (e.type === 'point') return e.standalone ? [{ ref: ref(e.id), type: 'point', ...flag }] : [];
    if (e.type === 'line')
      return e.owner
        ? []
        : [{ ref: ref(e.id), type: 'line', a: at(e.startId), b: at(e.endId), ends: [ref(e.startId), ref(e.endId)], ...flag }];
    if (e.type === 'circle') return [{ ref: ref(e.id), type: 'circle', at: at(e.centerId), d: round(e.radius * 2), ...flag }];
    if (e.type === 'arc')
      return [
        {
          ref: ref(e.id),
          type: 'arc',
          at: at(e.centerId),
          r: round(e.radius),
          a: at(e.startId),
          b: at(e.endId),
          ends: [ref(e.startId), ref(e.endId)],
          ...flag,
        },
      ];
    return [{ ref: ref(e.id), type: e.type, ...nativeCurveReport(sketch, e, ref), ...flag }];
  });
}

/** Room around the part on its board, mm: enough for the bit and the tabs. */
const BOARD_MARGIN = 20;

/**
 * Planned summaries by everything planning reads, so inspecting a design again (the assistant inspects the open design
 * and each checked candidate) only plans the parts that changed. Planning one part takes up to a second.
 */
const plannedSummaries = new Map<string, CadToolpathSummary>();
const kPlannedSummaries = 256;

function toolpathSummary(source: EvaluatedCadPart, profile: ReturnType<typeof profileFeatures>, cornerRelief?: number): CadToolpathSummary {
  // `profile` is derived from these fields alone, and the board from them and the profile.
  const { partId, name, thickness, outline, holes, cuts } = source;
  const key = JSON.stringify({ partId, name, thickness, outline, holes, cuts, cornerRelief });
  let summary = plannedSummaries.get(key);
  if (!summary) {
    summary = planToolpathSummary(source, profile, cornerRelief);
    if (plannedSummaries.size >= kPlannedSummaries) plannedSummaries.delete(plannedSummaries.keys().next().value!);
    plannedSummaries.set(key, summary);
  }
  // Each report gets its own copy, so a caller changing one can't change what a later inspection returns.
  return structuredClone(summary);
}

function planToolpathSummary(
  source: EvaluatedCadPart,
  profile: ReturnType<typeof profileFeatures>,
  cornerRelief?: number
): CadToolpathSummary {
  const [w, h] = profile.size;
  const board: BoardRequest = {
    id: 'check',
    name: source.name,
    w: w + 2 * BOARD_MARGIN,
    h: h + 2 * BOARD_MARGIN,
    thickness: source.thickness,
    stockTop: source.thickness,
    holdDown: 'tabs',
    clearHoles: true,
    tabs: DEFAULT_TABS,
    parts: [{ id: 'part', partId: source.partId, name: source.name, x: BOARD_MARGIN, y: BOARD_MARGIN, rotated: false }],
    // Cuts from below come from a second side, after turning the board over, lined up by the camera as the app's default.
    ...(profile.turned && { flip: { registration: 'camera' as const } }),
  };
  const plan = planBoard(
    board,
    {},
    {
      part: () => ({ size: profile.size, features: profile.features, ...(cornerRelief && { cornerRelief }) }),
      underside: (_, rotated) => profile.turned?.(rotated ? 'y' : 'x') ?? profile.features,
    }
  );
  return { bit: DEFAULT_SETTINGS.tools[0]!.diameter, ...planSummary(plan) };
}

/** A planned board's operations, time, CAM warnings, and what would block the job, side B included. */
export function planSummary(plan: PlanResult): Omit<CadToolpathSummary, 'bit'> {
  const sideB = plan.sideB;
  const operations = (from: PlanResult, prefix: string) =>
    from.ops.map(op => ({
      label: `${prefix}${op.label.replace(/^[^·]+ · /, '')}`,
      depth: round(op.zTop - op.zBottom),
      steps: op.depthSteps,
    }));
  return {
    minutes: Math.round((plan.timeMin + (sideB?.timeMin ?? 0)) * 10) / 10,
    operations: [...operations(plan, ''), ...(sideB ? operations(sideB, 'Side B: ') : [])],
    warnings: [...plan.warnings, ...(sideB?.warnings ?? [])],
    blocked: [
      ...plan.safety,
      ...(sideB?.safety ?? []),
      ...(plan.flip?.problem ? [plan.flip.problem] : []),
      ...(plan.timeline ?? []).filter(event => event.block).map(event => event.message),
      ...(plan.hold ?? []).filter(hold => !hold.ok).map(hold => `${hold.part} isn’t held by enough tabs.`),
      ...(plan.holdClash?.length ? ['The bit would hit a hold-down.'] : []),
    ],
  };
}

function checkExpectation(want: CadExpectation, part: CadReportPart, freedom: number, document: CadDocument): string[] {
  const tolerance = want.tolerance ?? 0.01;
  const close = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  const failures: string[] = [];
  const value = (input: number | string, field: string): number => {
    if (typeof input === 'number') return input;
    const parsed = parseCadValue(input, { unit: 'mm', variables: cadVariableScope(document) });
    if ('error' in parsed) {
      failures.push(`${field}: invalid expression "${input}": ${parsed.error}`);
      return NaN;
    }
    return parsed.value;
  };
  const wantedSize = want.size?.map(input => value(input, 'size'));
  const thickness = want.thickness === undefined ? undefined : value(want.thickness, 'thickness');
  const depths = want.depths?.map(input => value(input, 'depths'));
  const size = part.outline?.size;
  if (want.size && !(size && close(size[0]!, wantedSize![0]!) && close(size[1]!, wantedSize![1]!)))
    failures.push(`size: wanted ${want.size.join(' × ')}, got ${size?.join(' × ') ?? 'no outline'}`);
  if (want.thickness !== undefined && !close(part.thickness, thickness!))
    failures.push(`thickness: wanted ${want.thickness}, got ${part.thickness}`);
  if (want.notches !== undefined && part.notches !== want.notches) failures.push(`notches: wanted ${want.notches}, got ${part.notches}`);
  if (want.holes !== undefined && part.holes !== want.holes) failures.push(`holes: wanted ${want.holes}, got ${part.holes}`);
  const pockets = part.cuts.filter(cut => !cut.through).length;
  if (want.pockets !== undefined && pockets !== want.pockets) failures.push(`pockets: wanted ${want.pockets}, got ${pockets}`);
  if (want.freedom !== undefined && freedom !== want.freedom) failures.push(`freedom: wanted ${want.freedom}, got ${freedom}`);
  if (want.depths) {
    const got = part.cuts.map(cut => cut.to);
    if (got.length !== want.depths.length || got.some((depth, i) => !close(depth, depths![i]!)))
      failures.push(`depths: wanted ${want.depths.join(', ')}, got ${got.join(', ')}`);
  }
  return failures;
}

/** Solves a document and describes it without IDs longer than they need to be, so a script can act on it next. */
export async function inspectCadDocument(
  input: CadDocument,
  expectations: ReadonlyMap<string, readonly CadExpectation[]> = new Map(),
  options: { toolpaths?: boolean } = {}
): Promise<{ document: CadDocument; report: CadReport; parts: EvaluatedCadPart[] }> {
  const solved = await solveCadDocument(input);
  const nameOf = (partId?: string) => solved.document.parts.find(part => part.id === partId)?.name;
  const errors: CadReportIssue[] = [],
    warnings: CadReportIssue[] = [];
  const entityHandles = (partId: string | undefined, ids: readonly string[] | undefined) => {
    const part = solved.document.parts.find(candidate => candidate.id === partId);
    if (!part || !ids?.length) return undefined;
    const all = [part.sketch, ...cadFaceSketches(part).map(face => face.sketch)].flatMap(sketch => sketch.entities.map(e => e.id));
    const handles = shortHandles(all);
    return ids.map(id => handles.get(id) ?? id);
  };
  // A value that can't follow its variables keeps its last good one, so the design the check solved disagrees with them.
  for (const d of [...solved.diagnostics, ...cadVariableProblems(input)]) {
    const part = solved.document.parts.find(part => part.id === d.partId);
    const constraints = part && [part.sketch, ...cadFaceSketches(part).map(face => face.sketch)].flatMap(sketch => sketch.constraints);
    const ids =
      d.code === 'redundant-constraint'
        ? [
            ...new Set([
              ...(d.entityIds ?? []),
              ...(constraints ?? []).filter(c => d.constraintIds?.includes(c.id)).flatMap(constraintEntityIds),
            ]),
          ]
        : d.entityIds;
    const entities = entityHandles(d.partId, ids);
    const at = d.points?.length ? d.points.map(xy) : undefined;
    const message =
      d.code === 'redundant-constraint' && entities?.length
        ? `${d.message} Entities: ${entities.join(', ')}.`
        : at
          ? `${d.message} At ${at.map(p => `[${p.join(', ')}]`).join(', ')}.`
          : d.message;
    const issue = { code: d.code, message, part: nameOf(d.partId), entities, ...(at && { at }) };
    (d.severity === 'error' ? errors : warnings).push(issue);
  }
  const statuses = solved.sketches;
  const toCut = cadPartsToCut(solved.document, solved.parts);
  // Physical membership is derived for quantity/name metadata; authoring sketches and history stay in the saved source.
  const physical = physicalJoinedCopies(activeDesign(solved.document));
  // Bones widen a cut past what was drawn, so its opening is measured on the part without them.
  // A Cut parts step can relieve its own openings, so its override is dropped as well.
  const unrelieved =
    solved.document.parts.some(part => part.cornerRelief) || solved.document.partCuts?.some(step => step.cornerRelief)
      ? evaluateCadDocument({
          ...solved.document,
          parts: solved.document.parts.map(({ cornerRelief: _cornerRelief, ...part }) => part),
          partCuts: solved.document.partCuts?.map(({ cornerRelief: _cornerRelief, ...step }) => step),
        }).parts
      : solved.parts;
  const parts = solved.document.parts.map((part: CadPart): CadReportPart => {
    const physicalPart = physical.parts.find(candidate => candidate.id === part.id)!;
    const evaluated = solved.parts.find(candidate => candidate.partId === part.id);
    const faces = cadFaceSketches(part);
    const statusesOf = statuses.filter(status => status.partId === part.id);
    const featureHandles = shortHandles((part.features ?? []).map(f => f.id));
    // A pattern copy's cut is its original's, with the copy's place in the pattern after a ~.
    const cutHandle = (id: string) => {
      // An opening another part cuts is named after that part, or the copy of it, with the piece's number after a #.
      const byPart = /^cut-parts:[^:]+:([^:#]+)(?::([^#]+))?(#\d+)?$/.exec(id);
      if (byPart) {
        const [, toolId, copyId, piece = ''] = byPart;
        const tool = physical.parts.find(candidate => candidate.id === toolId);
        const index = copyId === undefined ? -1 : (tool?.copies ?? []).findIndex(copy => copy.id === copyId);
        return `${tool ? (index >= 0 ? cadCopyName(tool, index) : tool.name) : 'a part that is gone'}${piece}`;
      }
      const [base, copy] = id.split('~');
      return `${featureHandles.get(base!) ?? base}${copy === undefined ? '' : `~${copy}`}`;
    };
    const sketchHandles = shortHandles(faces.map(face => face.sketch.id));
    const sketches: { sketch: CadSketch; ref: string; on: CadReportPart['sketches'][number]['on'] }[] = [
      { sketch: part.sketch, ref: 'profile', on: 'profile' as const },
      ...faces.map(face => ({
        sketch: face.sketch,
        ref: sketchHandles.get(face.sketch.id)!,
        on: typeof face.on === 'object' ? { floorOf: featureHandles.get(face.on.floorOf) ?? face.on.floorOf } : face.on,
      })),
    ];
    // The solver reports on the sketches it solves here, in this order: a shared or Remove step's sketch is solved where
    // it's drawn, so it has no status of its own on this part.
    const solvedHere = [!part.sketchOf, ...faces.map(face => !face.removedBy)];
    const statusOf = (i: number) => (solvedHere[i] ? statusesOf[solvedHere.slice(0, i).filter(Boolean).length] : undefined);
    // Curve and fitting reports can reference every control and dimension. Build each shortest-prefix map once,
    // rather than rebuilding its quadratic collision search for every reference in a large fitted sketch.
    const handlesBySketch = new Map(
      sketches.map(({ sketch }) => [
        sketch.id,
        {
          entities: shortHandles(sketch.entities.map(entity => entity.id)),
          constraints: shortHandles(sketch.constraints.map(constraint => constraint.id)),
        },
      ])
    );
    const reported = sketches.map(({ sketch, ref, on }, i) => {
      const handles = handlesBySketch.get(sketch.id)!;
      const patterns = sketch.constraints.filter(c => c.type === 'linearPattern' || c.type === 'circularPattern');
      return {
        ref,
        on,
        freedom: statusOf(i)?.dof ?? null,
        status: solvedHere[i] ? (statusOf(i)?.status ?? 'invalid') : 'shared',
        entities: reportEntities(sketch, handles.entities),
        constraints: sketch.constraints.length,
        ...sketchCurveDetails(
          sketch,
          id => handles.entities.get(id) ?? id,
          id => handles.constraints.get(id) ?? id
        ),
        ...(patterns.length
          ? {
              patterns: patterns.map(pattern => ({
                ref: handles.constraints.get(pattern.id)!,
                copies: pattern.countX * pattern.countY - 1,
              })),
            }
          : {}),
      };
    });
    for (const sketch of [part.sketch, ...faces.map(face => face.sketch)]) {
      const regions = cadSketchRegions(part, sketch.id);
      const handles = handlesBySketch.get(sketch.id)!.constraints;
      // A copy cuts its outline less any islands inside it, so an island changes it as much as a changed outline.
      const area = (region: (typeof regions)[number]) =>
        Math.abs(polygonArea(region.points)) - region.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);
      for (const pattern of sketch.constraints) {
        if (pattern.type !== 'linearPattern' && pattern.type !== 'circularPattern') continue;
        const master = patternMaster(pattern);
        if (!master) continue;
        const seeds = new Map(Object.entries(master.idMap).map(([seed, id]) => [id, seed]));
        const originals = regions.filter(
          region => region.curveIds.some(id => seeds.has(id)) && region.curveIds.every(id => seeds.has(id) || id === `${part.id}:outline`)
        );
        if (!originals.length) continue;
        const missing = pattern.instances.filter(instance => {
          if (instance === master || !instance.activeIds.length) return false;
          return originals.some(original => {
            const mapped = original.curveIds.map(id => (seeds.has(id) ? instance.idMap[seeds.get(id)!] : id));
            // Excluded geometry and cells outside a shrunken pattern are intentional.
            if (mapped.some(id => !id || (id !== `${part.id}:outline` && !instance.activeIds.includes(id)))) return false;
            return !regions.some(
              region =>
                region.curveIds.length === mapped.length &&
                region.curveIds.every(id => mapped.includes(id)) &&
                Math.abs(area(region) - area(original)) < 1e-3 * Math.max(1, area(original))
            );
          });
        }).length;
        if (missing) {
          const ref = handles.get(pattern.id)!;
          warnings.push({
            code: 'pattern-copies-missing',
            part: part.name,
            entities: [ref],
            message: `Pattern ${ref}: ${missing} copies missing their original region shape after overlapping geometry.`,
          });
        }
      }
    }
    // Each loop is measured against the curves of its own sketch, so nearby geometry elsewhere can't widen it.
    const sketchOfCut = (id: string) => {
      const feature = part.features?.find(f => f.id === id.split('~')[0]);
      if (feature?.type !== 'cut') return undefined;
      // A profile loop given a depth is cut from the profile sketch itself.
      return feature.sketchId === part.sketch.id ? part.sketch : faces.find(face => face.sketch.id === feature.sketchId)?.sketch;
    };
    const drawn = unrelieved.find(candidate => candidate.partId === part.id)?.cuts;
    const reportCuts = (source: readonly EvaluatedCadCut[]) =>
      source.map(cut => {
        // Evaluated underside loops are reflected into part coordinates, as their curve extremes must be too.
        const curves = curveExtremes(sketchOfCut(cut.id)).map(p => (cut.side === 'underside' ? { x: -p.x, y: p.y } : p));
        const relieved = bounds(cut.outline, curves);
        const asDrawn = drawn?.find(candidate => candidate.id === cut.id);
        const { at, size } = asDrawn ? bounds(asDrawn.outline, curves) : relieved;
        const wider = relieved.size.some((length, i) => length > size[i]! + 1e-6);
        return {
          ref: cutHandle(cut.id),
          side: cut.side,
          from: round(cut.from),
          to: round(cut.to),
          through: cut.through,
          at,
          size,
          ...(wider && { relieved: relieved.size }),
        };
      });
    const cuts = reportCuts(evaluated?.cuts ?? []);
    const copyFeatures = Object.entries(evaluated?.copyCuts ?? {}).map(([id, cuts]) => ({
      ref: `${part.id}:${id}`,
      name: cadCopyName(
        physicalPart,
        (physicalPart.copies ?? []).findIndex(copy => copy.id === id)
      ),
      cuts: reportCuts(cuts),
    }));
    // CAM clips a floor cut to its pocket without a word, so the drawing and the part would disagree.
    for (const cut of evaluated?.cuts ?? []) {
      const feature = part.features?.find(f => f.id === cut.id);
      const face = feature?.type === 'cut' ? faces.find(candidate => candidate.sketch.id === feature.sketchId) : undefined;
      if (typeof face?.on !== 'object') continue;
      const floorId = face.on.floorOf;
      const parent = evaluated?.cuts?.find(candidate => candidate.id === floorId);
      if (
        parent &&
        cut.outline.some(p => !pointInPolygon(p, parent.outline) && !parent.outline.some(q => Math.hypot(p.x - q.x, p.y - q.y) < 1e-6))
      )
        warnings.push({
          code: 'cut-outside-floor',
          message: `A cut reaches beyond the floor it sits on, so only the part over that floor gets cut.`,
          part: part.name,
        });
    }
    let cam: CadReportPart['cam'];
    let toolpaths: CadToolpathSummary | undefined;
    // A sketch not yet extruded, or a step that adds to or cuts another part, isn't machined on its own.
    if (evaluated && isCadPart(part)) {
      {
        const profile = profileFeatures(evaluated);
        cam = {
          pockets: profile.features.pockets.length,
          throughHoles: profile.features.throughHoles.length,
          ...(profile.below && { undersidePockets: profile.below.pockets.length }),
        };
        if (profile.problem)
          errors.push({
            code: profile.problem.includes('split the part') ? 'cam-split' : 'cam-sides',
            message: profile.problem[0]!.toUpperCase() + profile.problem.slice(1),
            part: part.name,
          });
        else if (options.toolpaths !== false) {
          toolpaths = toolpathSummary(evaluated, profile, smallestCornerRelief(solved.document, part.id));
          // CAM leaves out what no tool fits, so the part wouldn't come out as drawn.
          const dropped = toolpaths.warnings.find(warning => warning.includes('no tool fits'));
          if (dropped) warnings.push({ code: 'toolpath-missing', message: `A cut wouldn't be machined: ${dropped}`, part: part.name });
          const unrelieved = toolpaths.warnings.find(warning => warning.includes('relieved for'));
          if (unrelieved) warnings.push({ code: 'relief-bit', message: unrelieved, part: part.name });
          if (toolpaths.blocked.length)
            warnings.push({
              code: 'toolpath-blocked',
              message: `Planned alone with tabs, the job would be blocked: ${toolpaths.blocked[0]}`,
              part: part.name,
            });
        }
      }
    }
    const box = evaluated && bounds(evaluated.outline, curveExtremes(part.sketch));
    // Copies cut differently are pieces of their own, `<id>[:mirrored]:copy:<copyId>`; list them with their kind.
    const names = (id: string) =>
      toCut.flatMap(entry => (entry.part.partId === id || entry.part.partId.startsWith(`${id}:copy:`) ? entry.names : []));
    const pieces =
      part.copies?.length || physicalPart.copies?.length ? { names: names(part.id), mirrored: names(mirroredPartId(part.id)) } : undefined;
    const report: CadReportPart = {
      name: part.name,
      thickness: part.thickness,
      ...(box && { outline: { at: box.at, size: box.size } }),
      // A profile loop explicitly cut through stays in holes and isn't also emitted as a cut.
      holes:
        evaluated &&
        evaluated.holes.length + (evaluated.cuts ?? []).filter(cut => cut.through && !isEdgeNotch(cut, evaluated.outline)).length,
      notches: evaluated && (evaluated.cuts ?? []).filter(cut => isEdgeNotch(cut, evaluated.outline)).length,
      cuts,
      sketches: reported,
      ...(copyFeatures.length && { copyFeatures }),
      ...(cam && { cam }),
      ...(pieces && { pieces }),
      ...(toolpaths && { toolpaths }),
    };
    const freedom = reported.reduce((sum, sketch) => sum + (sketch.freedom ?? 0), 0);
    for (const want of expectations.get(part.id) ?? [])
      for (const failure of checkExpectation(want, report, freedom, solved.document))
        errors.push({ code: 'expect-failed', message: failure, part: part.name });
    return report;
  });
  const assembly = assemblyReport(solved.document, solved.parts);
  const steps = cadStepReport(solved.document, solved.parts).map(step =>
    step.kind === 'drawnOn' && !('error' in step.frame) ? { ...step, frameInWords: frameInWords(step.on, step.frame) } : step
  );
  // A furniture construction is complete only while its measured joints and hardware still hold on this geometry.
  // A plan whose folder is switched off describes material that isn't built, so it has nothing to measure.
  const parked = new Set(solved.document.folders?.filter(folder => folder.suppressed).map(folder => folder.id));
  for (const plan of (solved.document.constructions ?? []).filter(plan => !parked.has(plan.folderId)))
    for (const check of checkFurnitureConstruction(solved.document, solved.parts, plan))
      if (!check.passed)
        errors.push({
          code: 'construction-check',
          message: `${plan.recipe} ${check.id}: ${check.check}${check.actual === undefined ? '' : ` Measured ${round(check.actual)}, needs ${check.expected === undefined ? 'more' : round(check.expected)}.`}`,
        });
  for (const collision of assembly?.collisions ?? [])
    errors.push({
      code: 'parts-collide',
      message: `${collision.parts[0]} and ${collision.parts[1]} both need the material in ${collision.size.join(' × ')} mm at ${collision.at.join(', ')}.`,
    });
  return {
    document: solved.document,
    parts: solved.parts,
    report: {
      ok: solved.status === 'solved' && !errors.length,
      status: solved.status,
      errors,
      warnings,
      parts,
      ...(assembly && { assembly }),
      ...(steps.length && { steps }),
    },
  };
}

const kAxisNames: [string, readonly number[]][] = [
  ['+x', [1, 0, 0]],
  ['-x', [-1, 0, 0]],
  ['+y', [0, 1, 0]],
  ['-y', [0, -1, 0]],
  ['+z', [0, 0, 1]],
  ['-z', [0, 0, -1]],
];
const axisName = (v: readonly number[]) =>
  kAxisNames.find(([, axis]) => axis.every((c, i) => Math.abs(c - v[i]!) < 1e-6))?.[0] ?? `(${v.map(c => round(c)).join(', ')})`;

/** A face's frame as a sentence, so a script's author can see where a part drawn on it starts and which way it runs. */
function frameInWords(
  on: string,
  frame: { origin: readonly number[]; x: readonly number[]; y: readonly number[]; normal: readonly number[] }
) {
  return `${on}: sketch origin at ${frame.origin.map(round).join(', ')}, its x along ${axisName(frame.x)}, its y along ${axisName(frame.y)}, looking ${axisName(frame.normal)}.`;
}
