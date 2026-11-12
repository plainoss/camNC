import {
  cadDatumFrame,
  cadFaceName,
  cadFaceSketches,
  cadPartFaces,
  cadPartsToCut,
  cadSketchRegions,
  cadVariableValues,
  designSteps,
  edgeFilletProblems,
  extrudeStepProblem,
  isCadPart,
  isSpatialRemoval,
  removalTargets,
  polygonArea,
  type CadDirection,
  type CadDocument,
  type CadDrawnOn,
  type CadPart,
  type CadPlacement,
  type CadSketch,
  type CadSketchRegion,
  type EvaluatedCadPart,
  smallestCornerRelief,
} from '@wbcnc/cad';
import { DEFAULT_SETTINGS, DEFAULT_TABS, nestRects, planBoard, profileFeatures, type BoardRequest } from '@wbcnc/cam';
import { inspectCadDocument, planSummary, shortHandles, type CadReport, type CadReportPart } from './inspect';
import { renderCadViews, type CadDrawing } from './views/render';
import { renderCadSection, type CadSectionDrawing, type CadSectionRequest } from './views/section';

/** Numbers in the report are rounded to this many decimals, so float noise never changes it. */
const kDecimals = 3;
type CadReportStep = NonNullable<CadReport['steps']>[number];

const round = (value: number) => {
  const rounded = Math.round(value * 10 ** kDecimals) / 10 ** kDecimals;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/**
 * The same value with numbers rounded, `-0` as `0` and `undefined` left out. Keys keep the fixed order the report is
 * built in, which reads in the order a person checks a design: its status, the feature list, sketches, parts, boards.
 * So two reports of the same design are the same text, and a diff of two designs' reports shows only what changed.
 */
export function canonicalJson(value: unknown): unknown {
  if (typeof value === 'number') return Number.isFinite(value) ? round(value) : String(value);
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value).flatMap(key => {
        const entry = (value as Record<string, unknown>)[key];
        return entry === undefined ? [] : [[key, canonicalJson(entry)]];
      })
    );
  return value;
}

/** The report as text: canonical JSON, one key per line, ending in a newline. */
export const fullReportText = (report: CadFullReport) => `${JSON.stringify(canonicalJson(report), null, 1)}\n`;

/** One region of a sketch, as a cut or an extrude picks it. */
export interface CadFullRegion {
  /** `r1`, `r2`, … in the sketch, ordered by where they are, bottom left first. */
  ref: string;
  at: number[];
  size: number[];
  /** mm², less the islands inside it. */
  area: number;
  islands: number;
}
export interface CadFullSketch {
  part: string;
  /** `profile`, or the face sketch's handle as in the check report. */
  ref: string;
  on: CadReportPart['sketches'][number]['on'];
  /** Free movement left, and the solver's word on it: solved, conflict, invalid, or shared when it's solved elsewhere. */
  freedom: number | null;
  status: string;
  constraints: Record<string, number>;
  entities: CadReportPart['sketches'][number]['entities'];
  patterns?: { ref: string; copies: number }[];
  regions: CadFullRegion[];
}
export interface CadFullFeature {
  /** The step's own ID in the document. */
  id: string;
  kind: 'variable' | 'plane' | 'sketch' | 'extrude' | 'move' | 'faceSketch' | 'cut' | 'fillet' | 'copy' | 'pattern' | 'partCut';
  /** As the feature list names it. */
  label: string;
  part?: string;
  suppressed?: true;
  settings: Record<string, unknown>;
  /** What it came to, or why it couldn't be made. */
  result: Record<string, unknown> | { error: string };
}
export interface CadFullBoard {
  name: string;
  thickness: number;
  /** Turned over for cuts from below. */
  sides: 1 | 2;
  /** The board fitted to its parts, mm. */
  size: number[];
  /** Part area over board area. */
  yield: number;
  parts: { name: string; at: number[]; size: number[]; rotated: boolean }[];
  /** Per part: how it's held (tabs placed, a skin, or nothing), and whether the tabs hold it once its outline is cut. */
  holding: { name: string; how: string; tabs: number; wanted?: number; anchored?: number; ok?: boolean }[];
  minutes: number;
  operations: { label: string; depth: number; steps: number }[];
  warnings: string[];
  blocked: string[];
}
export interface CadFullReport {
  design: { name: string; revision: number; version: number };
  /** False when anything is wrong, the check's expectations and a script that stopped included. */
  ok: boolean;
  /** Why the script stopped, when one did: the design reported on is then the one it started from. */
  scriptError?: string;
  /** Why a sketch asked for with --export-sketch couldn't be written: no sketch is named so. */
  exportError?: string;
  status: string;
  errors: CadReport['errors'];
  warnings: CadReport['warnings'];
  /** The feature list in order: variables, planes, then each part's steps as the studio lists them. */
  features: CadFullFeature[];
  /** Every sketch with its solver state, geometry and regions. */
  sketches: CadFullSketch[];
  /** Each part as made, with its cuts, what CAM received and its toolpath summary, planned alone. */
  bodies: (Omit<CadReportPart, 'sketches'> & { kind: string; faces?: { face: string; looks: string; origin: number[] }[] })[];
  assembly?: CadReport['assembly'];
  /** Every piece to cut, nested on boards of its thickness and planned together as the app plans a board. */
  boards: CadFullBoard[];
  /** Pieces CAM can't take, with why. */
  unplanned?: { name: string; problem: string }[];
  /** Optional evaluated geometry drawings, shared by the CLI, MCP and browser assistant. */
  views?: CadDrawing[];
  section?: CadSectionDrawing;
}

const kAxes: [string, number[]][] = [
  ['+x', [1, 0, 0]],
  ['-x', [-1, 0, 0]],
  ['+y', [0, 1, 0]],
  ['-y', [0, -1, 0]],
  ['+z', [0, 0, 1]],
  ['-z', [0, 0, -1]],
];
const axisName = (v: readonly number[]) =>
  kAxes.find(([, axis]) => axis.every((c, i) => Math.abs(c - v[i]!) < 1e-6))?.[0] ?? `(${v.map(round).join(', ')})`;
const vector = (values: readonly number[]) => values.map(round);
const placement = (value: CadPlacement | undefined) =>
  value && {
    position: vector(value.position),
    rotation: vector(value.rotation),
    ...(value.positionExpressions && { positionExpressions: value.positionExpressions }),
  };
const typed = (value: number | 'through', expression?: string) => ({ value: value === 'through' ? value : round(value), expression });

function regionsOf(part: CadPart, sketch: CadSketch): { regions: CadFullRegion[]; refs: Map<string, string> } {
  const area = (region: CadSketchRegion) =>
    Math.abs(polygonArea(region.points)) - region.holes.reduce((sum, hole) => sum + Math.abs(polygonArea(hole)), 0);
  const measured = cadSketchRegions(part, sketch.id).map(region => {
    const xs = region.points.map(p => p.x),
      ys = region.points.map(p => p.y);
    const [x0, y0] = [Math.min(...xs), Math.min(...ys)];
    return {
      id: region.id,
      at: [round(x0), round(y0)],
      size: [round(Math.max(...xs) - x0), round(Math.max(...ys) - y0)],
      area: round(area(region)),
      islands: region.holes.length,
    };
  });
  measured.sort((a, b) => a.at[1]! - b.at[1]! || a.at[0]! - b.at[0]! || a.area - b.area || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const refs = new Map(measured.map((region, i) => [region.id, `r${i + 1}`]));
  return { regions: measured.map(({ id, ...region }) => ({ ref: refs.get(id)!, ...region })), refs };
}

const constraintCounts = (sketch: CadSketch) => {
  const counts: Record<string, number> = {};
  for (const constraint of sketch.constraints) counts[constraint.type] = (counts[constraint.type] ?? 0) + 1;
  // By kind, so reordering a sketch's constraints doesn't change the report.
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => (a < b ? -1 : 1)));
};

/** Defaults the app starts a board with for parts held by tabs, mm: room between parts and inside the board's edge. */
const kTabWeb = 3.5;
const boardGap = (bit: number) => Math.ceil(2 * bit + kTabWeb);
const boardMargin = (bit: number) => +(bit + kTabWeb).toFixed(1);

function planBoards(document: CadDocument, parts: readonly EvaluatedCadPart[], relief: (partId: string) => number | undefined) {
  const bit = DEFAULT_SETTINGS.tools[0]!.diameter;
  const unplanned: { name: string; problem: string }[] = [];
  type Piece = { id: string; partId: string; name: string; profile: ReturnType<typeof profileFeatures>; cornerRelief?: number };
  const groups = new Map<string, Piece[]>();
  for (const entry of cadPartsToCut(document, parts)) {
    const profile = profileFeatures(entry.part);
    if (profile.problem) {
      for (const name of entry.names) unplanned.push({ name, problem: profile.problem });
      continue;
    }
    // Parts cut from both sides go on boards that are turned over, the rest on boards cut from one side.
    const key = `${round(entry.part.thickness)}:${profile.turned ? 2 : 1}`;
    const cornerRelief = relief(entry.part.partId.split(':')[0]!);
    const pieces = entry.names.map((name, i) => ({
      id: `${entry.part.partId}#${i}`,
      partId: entry.part.partId,
      name,
      profile,
      ...(cornerRelief && { cornerRelief }),
    }));
    groups.set(key, [...(groups.get(key) ?? []), ...pieces]);
  }
  const keys = [...groups.keys()].sort((a, b) => {
    const [ta, sa] = a.split(':').map(Number),
      [tb, sb] = b.split(':').map(Number);
    return ta! - tb! || sa! - sb!;
  });
  const boards: CadFullBoard[] = keys.map((key, index) => {
    const pieces = groups.get(key)!;
    const [thickness, sides] = key.split(':').map(Number) as [number, 1 | 2];
    const nest = nestRects(
      pieces.map(piece => ({ id: piece.id, w: piece.profile.size[0], h: piece.profile.size[1] })),
      { gap: boardGap(bit), margin: boardMargin(bit) }
    );
    const byId = new Map(pieces.map(piece => [piece.id, piece]));
    const name = String.fromCharCode(65 + (index % 26)) + (index >= 26 ? String(Math.floor(index / 26)) : '');
    const request: BoardRequest = {
      id: `board-${name}`,
      name,
      w: nest.board.w,
      h: nest.board.h,
      thickness,
      stockTop: thickness,
      holdDown: 'tabs',
      clearHoles: true,
      tabs: DEFAULT_TABS,
      parts: nest.placements.map(placed => ({
        id: placed.id,
        partId: placed.id,
        name: byId.get(placed.id)!.name,
        x: placed.x,
        y: placed.y,
        rotated: placed.rotated,
      })),
      ...(sides === 2 && { flip: { registration: 'camera' as const } }),
    };
    const plan = planBoard(
      request,
      {},
      {
        part: id => {
          const piece = byId.get(id)!;
          return {
            size: piece.profile.size,
            features: piece.profile.features,
            ...(piece.cornerRelief && { cornerRelief: piece.cornerRelief }),
          };
        },
        underside: (id, rotated) => {
          const { profile } = byId.get(id)!;
          return profile.turned?.(rotated ? 'y' : 'x') ?? profile.features;
        },
      }
    );
    const holds = new Map((plan.hold ?? []).map(hold => [hold.part, hold]));
    return {
      name: `Board ${name}`,
      thickness,
      sides,
      size: [round(nest.board.w), round(nest.board.h)],
      yield: round(nest.yield),
      parts: nest.placements.map(placed => {
        const piece = byId.get(placed.id)!;
        const [w, h] = piece.profile.size;
        return {
          name: piece.name,
          at: [round(placed.x), round(placed.y)],
          size: placed.rotated ? [h, w] : [w, h],
          rotated: placed.rotated,
        };
      }),
      holding: (plan.holding ?? []).map(holding => {
        const hold = holds.get(holding.name);
        return {
          name: holding.name,
          how: holding.how,
          tabs: holding.tabs,
          ...(holding.wanted !== undefined && { wanted: holding.wanted }),
          ...(hold && { anchored: hold.anchored, ok: hold.ok }),
        };
      }),
      ...planSummary(plan),
    };
  });
  return { boards, unplanned };
}

function sketchKey(part: CadPart, ref: string) {
  return `${part.name} / ${ref}`;
}

/**
 * Everything a design is and makes, for checking a change without the app: the feature list in order with each step's
 * settings and result, every sketch's solver state and regions, the parts as made, and the boards CAM would cut them
 * from with the default bit, settings and tabs. Built on the check report, so the two always agree.
 */
export async function fullCadReport(
  input: CadDocument,
  /** The check of `input`, when it's been made already, so it isn't solved and planned twice, with why its script stopped, if it did. */
  inspected?: { document: CadDocument; report: CadReport; parts: EvaluatedCadPart[]; scriptError?: string },
  drawings: { views?: boolean; section?: CadSectionRequest } = {}
): Promise<CadFullReport> {
  const { document, report, parts } = inspected ?? (await inspectCadDocument(input));
  const byId = new Map(document.parts.map(part => [part.id, part]));
  const partName = (id: string) => byId.get(id)?.name ?? 'a part that is gone';
  const reportOf = new Map(document.parts.map((part, i) => [part.id, report.parts[i]!]));
  const faceOn = (on: CadDrawnOn['on']) => cadFaceName(document, on);
  const direction = (value: CadDirection | undefined) => value && { along: faceOn(value.along), ...(value.flip && { flip: true }) };

  // Sketches, with their regions, so steps can name the regions they use.
  const sketches: CadFullSketch[] = [];
  const regionRefs = new Map<string, Map<string, string>>();
  const sketchRefs = new Map<string, string>();
  const sketchByKey = new Map<string, CadFullSketch>();
  for (const part of document.parts) {
    const reported = reportOf.get(part.id)!;
    const all = [part.sketch, ...cadFaceSketches(part).map(face => face.sketch)];
    all.forEach((sketch, i) => {
      const entry = reported.sketches[i]!;
      const { regions, refs } = regionsOf(part, sketch);
      regionRefs.set(`${part.id}\n${sketch.id}`, refs);
      sketchRefs.set(`${part.id}\n${sketch.id}`, sketchKey(part, entry.ref));
      const full: CadFullSketch = {
        part: part.name,
        ref: entry.ref,
        on: entry.on,
        freedom: entry.freedom,
        status: entry.status,
        constraints: constraintCounts(sketch),
        entities: entry.entities,
        ...(entry.patterns && { patterns: entry.patterns }),
        regions,
      };
      sketches.push(full);
      sketchByKey.set(`${part.id}\n${sketch.id}`, full);
    });
  }
  const sketchState = (part: CadPart, sketchId: string) => {
    const sketch = sketchByKey.get(`${part.id}\n${sketchId}`);
    return sketch
      ? { sketch: sketchKey(part, sketch.ref), freedom: sketch.freedom, status: sketch.status, regions: sketch.regions.length }
      : { error: 'The sketch is gone.' };
  };
  const regionRef = (partId: string, sketchId: string, regionId: string) =>
    regionRefs.get(`${partId}\n${sketchId}`)?.get(regionId) ?? `missing region`;

  const steps = report.steps ?? [];
  const stepFor = <K extends CadReportStep['kind']>(kind: K, match: (step: Extract<CadReportStep, { kind: K }>) => boolean) =>
    steps.find(step => step.kind === kind && match(step as Extract<CadReportStep, { kind: K }>)) as
      | Extract<CadReportStep, { kind: K }>
      | undefined;
  const { scope, errors: variableErrors } = cadVariableValues(document);
  /** The cuts a cut feature made, pattern copies included, as the check report measures them. */
  const madeCuts = (part: CadPart, featureId: string) => {
    const handle = shortHandles((part.features ?? []).map(feature => feature.id)).get(featureId)!;
    return reportOf
      .get(part.id)!
      .cuts.filter(candidate => candidate.ref === handle || candidate.ref.startsWith(`${handle}~`))
      .map(candidate => {
        const { ref: _, ...cut } = candidate;
        return cut;
      });
  };
  const partErrors = (partId: string) => report.errors.filter(error => error.part === partName(partId)).map(error => error.message);

  const features: CadFullFeature[] = [
    ...(document.variables ?? []).map(
      (variable): CadFullFeature => ({
        id: variable.id,
        kind: 'variable',
        label: `#${variable.name}`,
        settings: { expression: variable.expression },
        result: variableErrors[variable.id]
          ? { error: variableErrors[variable.id]! }
          : { value: round(scope[variable.name]!.value), kind: scope[variable.name]!.kind },
      })
    ),
    ...(document.planes ?? []).map((plane): CadFullFeature => {
      const frame = cadDatumFrame(document, plane.id);
      return {
        id: plane.id,
        kind: 'plane',
        label: plane.name,
        settings: { on: faceOn(plane.on), offset: typed(plane.offset, plane.offsetExpression) },
        result: frame
          ? { origin: vector(frame.origin), x: vector(frame.x), y: vector(frame.y), normal: vector(frame.normal) }
          : { error: 'What the plane is on is gone.' },
      };
    }),
    ...designSteps(document).map((step): CadFullFeature => {
      const part = byId.get(step.partId)!;
      const base = {
        id: step.id,
        kind: step.kind,
        label: step.label,
        part: part?.name,
        ...(step.suppressed && { suppressed: true as const }),
      };
      if (step.kind === 'sketch')
        return {
          ...base,
          settings: {
            on: part.drawnOn ? faceOn(part.drawnOn.on) : 'not placed',
            ...(part.extrude === false && { extruded: false }),
          },
          result: sketchState(part, part.sketch.id),
        };
      if (step.kind === 'extrude') {
        const owner = part.sketchOf ? byId.get(part.sketchOf) : part;
        const regionIds = (ids: string[] | undefined) => ids?.map(id => regionRef(owner?.id ?? part.id, part.sketch.id, id));
        const problem = extrudeStepProblem(document, part);
        const body = reportOf.get(part.id)!;
        const made = parts.some(candidate => candidate.partId === part.id);
        const drawn = stepFor('drawnOn', entry => entry.partId === part.id);
        const result = problem
          ? { error: problem }
          : part.suppressed
            ? { made: 'nothing: suppressed' }
            : part.addTo
              ? { addsTo: partName(part.addTo) }
              : part.remove
                ? (() => {
                    if (isSpatialRemoval(part)) {
                      return {
                        removesFrom: removalTargets(document, part).map(target => target.name),
                        cuts: parts.flatMap(target =>
                          (target.cuts ?? [])
                            .filter(cut => cut.id.startsWith(`cut-parts:remove-${part.id}:`))
                            .map(cut => ({ part: target.name, side: cut.side, from: cut.from, to: cut.to, through: cut.through }))
                        ),
                      };
                    }
                    const target = document.parts.find(candidate =>
                      candidate.features?.some(feature => feature.type === 'cut' && feature.removedBy === part.id)
                    );
                    if (!target) return { error: partErrors(part.id)[0] ?? 'It cuts nothing.' };
                    const cuts = target.features!.flatMap(feature =>
                      feature.type === 'cut' && feature.removedBy === part.id ? madeCuts(target, feature.id) : []
                    );
                    return { removesFrom: target.name, cuts };
                  })()
                : made
                  ? {
                      thickness: body.thickness,
                      ...(body.outline && { outline: body.outline }),
                      holes: body.holes,
                      notches: body.notches,
                      ...(drawn && { on: 'error' in drawn.frame ? { error: drawn.frame.error } : drawn.frameInWords }),
                    }
                  : { error: partErrors(part.id)[0] ?? 'The part could not be made.' };
        return {
          ...base,
          settings: {
            thickness: typed(part.thickness, part.thicknessExpression),
            ...(part.sketchOf && { sketchOf: partName(part.sketchOf) }),
            ...(part.faceProfile && part.drawnOn && { faceProfile: faceOn(part.drawnOn.on) }),
            ...(part.regions && { regions: regionIds(part.regions) }),
            ...(part.addedRegions && { addedRegions: regionIds(part.addedRegions) }),
            ...(part.addTo && { addTo: partName(part.addTo) }),
            ...(part.remove && {
              remove: {
                depth: typed(part.remove.depth, part.remove.depthExpression),
                ...(part.remove.targets && { targets: part.remove.targets.map(partName) }),
              },
            }),
            ...(part.upTo && { upTo: faceOn(part.upTo) }),
            ...(part.symmetric && { symmetric: true }),
            ...(part.thin && {
              thin: { depth: typed(part.thin.depth, part.thin.depthExpression), ...(part.thin.midPlane && { midPlane: true }) },
            }),
            ...(part.drawnOn && {
              drawnOn: {
                on: faceOn(part.drawnOn.on),
                offset: typed(part.drawnOn.offset, part.drawnOn.offsetExpression),
                ...(part.drawnOn.inward && { inward: true }),
                ...(part.drawnOn.datum && {
                  plane: document.planes?.find(plane => plane.id === part.drawnOn!.datum)?.name ?? 'a plane that is gone',
                }),
              },
            }),
            ...(!part.drawnOn && part.placement && { placement: placement(part.placement) }),
            ...(part.cornerRelief && { cornerRelief: typed(part.cornerRelief.diameter, part.cornerRelief.diameterExpression) }),
          },
          result,
        };
      }
      if (step.kind === 'move') {
        const moved = part.moved!;
        return {
          ...base,
          settings:
            'by' in moved
              ? { by: vector(moved.by), ...(moved.byExpressions && { byExpressions: moved.byExpressions }) }
              : { ...direction(moved), distance: round(moved.distance) },
          result: { placement: placement(part.placement) ?? 'not placed' },
        };
      }
      if (step.kind === 'faceSketch') {
        const face = cadFaceSketches(part).find(candidate => candidate.id === step.id)!;
        const on = typeof face.on === 'object' ? { floorOf: face.on.floorOf } : face.on;
        return { ...base, settings: { on }, result: sketchState(part, face.sketch.id) };
      }
      if (step.kind === 'cut') {
        const cut = (part.features ?? []).find(feature => feature.id === step.id && feature.type === 'cut');
        if (cut?.type !== 'cut') return { ...base, settings: {}, result: { error: 'The cut is gone.' } };
        const made = madeCuts(part, cut.id);
        return {
          ...base,
          settings: {
            sketch: sketchRefs.get(`${part.id}\n${cut.sketchId}`) ?? 'a sketch that is gone',
            region: regionRef(part.id, cut.sketchId, cut.regionId),
            depth: typed(cut.depth, cut.depthExpression),
          },
          result: cut.suppressed ? { cuts: [] } : made.length ? { cuts: made } : { error: partErrors(part.id)[0] ?? 'It cuts nothing.' },
        };
      }
      if (step.kind === 'copy') {
        const index = (part.copies ?? []).findIndex(copy => copy.id === step.id);
        const copy = part.copies![index]!;
        return {
          ...base,
          settings: {
            ...(copy.name && { name: copy.name }),
            ...(copy.mirrored && { mirrored: true }),
            ...(copy.offset && { offset: placement(copy.offset) }),
            ...(copy.along && { along: { ...direction(copy.along), distance: typed(copy.along.distance, copy.along.distanceExpression) } }),
            ...(!copy.offset && !copy.along && copy.placement && { placement: placement(copy.placement) }),
          },
          result: { placement: placement(copy.placement) ?? 'not placed' },
        };
      }
      if (step.kind === 'pattern') {
        const pattern = part.pattern!;
        const made = stepFor('pattern', entry => entry.partId === part.id);
        return {
          ...base,
          settings: pattern.circular
            ? {
                count: typed(pattern.count, pattern.countExpression),
                circular: {
                  origin: vector(pattern.circular.origin),
                  axis: vector(pattern.circular.axis),
                  angle: typed(pattern.circular.angle, pattern.circular.angleExpression),
                  equalSpacing: pattern.circular.equalSpacing !== false,
                  opposite: !!pattern.circular.opposite,
                },
              }
            : {
                axis: pattern.axis,
                ...(pattern.direction && { direction: direction(pattern.direction) }),
                count: typed(pattern.count, pattern.countExpression),
                spacing: typed(pattern.spacing, pattern.spacingExpression),
              },
          result: made ? { copies: made.copies } : { error: 'The pattern made no copies.' },
        };
      }
      if (step.kind === 'fillet') {
        const fillet = part.fillets!.find(candidate => candidate.id === step.id)!;
        // Corners the radius can't take are left sharp, and the step says how many and why.
        const sharp = step.broken ? (edgeFilletProblems(part).find(problem => problem.filletId === fillet.id)?.corners.length ?? 0) : 0;
        return {
          ...base,
          settings: { corners: fillet.corners.length, radius: typed(fillet.radius, fillet.radiusExpression) },
          result: step.broken
            ? { corners: fillet.corners.length, rounded: fillet.corners.length - sharp, sharp, problem: step.broken }
            : { corners: fillet.corners.length },
        };
      }
      // Cut parts.
      const partCut = document.partCuts!.find(candidate => candidate.id === step.partCutId)!;
      const made = stepFor('partCut', entry => entry.stepId === partCut.id);
      return {
        ...base,
        settings: {
          tools: made?.tools ?? partCut.tools,
          targets: made?.targets ?? partCut.targets.map(partName),
          clearance: typed(partCut.clearance, partCut.clearanceExpression),
          ...(partCut.split && {
            split: partCut.split === 'half' ? 'half' : { fingers: typed(partCut.split.fingers, partCut.split.fingersExpression) },
          }),
        },
        result: made ? { openings: made.cuts } : { error: 'Nothing was cut.' },
      };
    }),
  ];

  const bodies = document.parts.map((part, i) => {
    const { sketches: _, ...body } = report.parts[i]!;
    const kind =
      part.extrude === false
        ? 'sketch'
        : part.suppressed
          ? 'suppressed'
          : part.addTo
            ? 'add'
            : part.remove
              ? 'remove'
              : isCadPart(part)
                ? 'part'
                : 'other';
    const handles = shortHandles(part.sketch.entities.map(entity => entity.id));
    const faces =
      kind === 'part'
        ? cadPartFaces(document, part)?.map(({ face, frame }) => ({
            face: typeof face === 'object' ? `edge ${handles.get(face.edge) ?? face.edge}` : face,
            looks: axisName(frame.normal),
            origin: vector(frame.origin),
          }))
        : undefined;
    return { kind, ...body, ...(faces && { faces }) };
  });
  const { boards, unplanned } = planBoards(document, parts, partId => smallestCornerRelief(document, partId));
  return {
    design: { name: document.name, revision: document.revision, version: document.version },
    ok: report.ok && !inspected?.scriptError,
    ...(inspected?.scriptError && { scriptError: inspected.scriptError }),
    status: report.status,
    errors: report.errors,
    warnings: report.warnings,
    features,
    sketches,
    bodies,
    ...(report.assembly && { assembly: report.assembly }),
    boards,
    ...(unplanned.length && { unplanned }),
    ...(drawings.views && { views: renderCadViews(document, parts) }),
    ...(drawings.section && { section: renderCadSection(document, parts, drawings.section) }),
  };
}
