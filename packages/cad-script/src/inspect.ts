import {
  cadFaceSketches,
  pointInPolygon,
  polygonArea,
  solveCadDocument,
  type CadDocument,
  type CadPart,
  type CadPoint,
  type CadSketch,
  type EvaluatedCadPart,
} from '@wbcnc/cad';
import { featuresFromCuts } from '@wbcnc/cam';

export interface CadExpectation {
  /** Width and height of the outline, in mm. */
  size?: readonly [number, number];
  thickness?: number;
  holes?: number;
  /** Pockets as CAM sees them. */
  pockets?: number;
  /** Every cut's floor, in mm below the top or underside, in feature order. */
  depths?: readonly number[];
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
}
export type CadReportEntity =
  | { ref: string; type: 'line'; a: number[]; b: number[]; ends: string[]; construction?: true }
  | { ref: string; type: 'circle'; at: number[]; d: number; construction?: true }
  | { ref: string; type: 'arc'; at: number[]; r: number; a: number[]; b: number[]; ends: string[]; construction?: true }
  | { ref: string; type: string; construction?: true };
export interface CadReportPart {
  name: string;
  thickness: number;
  /** Absent when the outline isn't a valid closed profile. */
  outline?: { at: number[]; size: number[] };
  holes?: number;
  cuts: { ref: string; side: 'top' | 'underside'; from: number; to: number; through: boolean; at: number[]; size: number[] }[];
  sketches: {
    ref: string;
    on: 'profile' | 'top' | 'underside' | { floorOf: string };
    freedom: number | null;
    status: string;
    entities: CadReportEntity[];
    constraints: number;
  }[];
  /** Features CAM received. Toolpaths and G-code aren't checked here, and nothing here says a program is safe to run. */
  cam?: { pockets: number; throughHoles: number };
}
export interface CadReport {
  ok: boolean;
  status: string;
  errors: CadReportIssue[];
  warnings: CadReportIssue[];
  parts: CadReportPart[];
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const xy = (p: CadPoint) => [round(p.x), round(p.y)];
function bounds(points: readonly CadPoint[]) {
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

function reportEntities(sketch: CadSketch): CadReportEntity[] {
  const handles = shortHandles(sketch.entities.map(e => e.id));
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
    return [{ ref: ref(e.id), type: e.type, ...flag }];
  });
}

function camFeatures(source: EvaluatedCadPart) {
  const positive = (loop: CadPoint[]) => (polygonArea(loop) < 0 ? [...loop].reverse() : loop);
  const inner = source.holes.map(positive);
  if (!source.cuts?.length) return { pockets: 0, throughHoles: inner.length, outlines: 1 };
  const { features } = featuresFromCuts({
    thickness: source.thickness,
    outline: positive(source.outline),
    holes: inner,
    cuts: source.cuts,
  });
  return { pockets: features.pockets.length, throughHoles: features.throughHoles.length, outlines: features.outlines.length };
}

function checkExpectation(want: CadExpectation, part: CadReportPart, freedom: number): string[] {
  const tolerance = want.tolerance ?? 0.01;
  const close = (a: number, b: number) => Math.abs(a - b) <= tolerance;
  const failures: string[] = [];
  const size = part.outline?.size;
  if (want.size && !(size && close(size[0]!, want.size[0]) && close(size[1]!, want.size[1])))
    failures.push(`size: wanted ${want.size.join(' × ')}, got ${size?.join(' × ') ?? 'no outline'}`);
  if (want.thickness !== undefined && !close(part.thickness, want.thickness))
    failures.push(`thickness: wanted ${want.thickness}, got ${part.thickness}`);
  if (want.holes !== undefined && part.holes !== want.holes) failures.push(`holes: wanted ${want.holes}, got ${part.holes}`);
  if (want.pockets !== undefined && part.cam?.pockets !== want.pockets)
    failures.push(`pockets: wanted ${want.pockets}, got ${part.cam?.pockets}`);
  if (want.freedom !== undefined && freedom !== want.freedom) failures.push(`freedom: wanted ${want.freedom}, got ${freedom}`);
  if (want.depths) {
    const got = part.cuts.map(cut => cut.to);
    if (got.length !== want.depths.length || got.some((depth, i) => !close(depth, want.depths![i]!)))
      failures.push(`depths: wanted ${want.depths.join(', ')}, got ${got.join(', ')}`);
  }
  return failures;
}

/** Solves a document and describes it without IDs longer than they need to be, so a script can act on it next. */
export async function inspectCadDocument(
  input: CadDocument,
  expectations: ReadonlyMap<string, readonly CadExpectation[]> = new Map()
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
  for (const d of solved.diagnostics) {
    const issue = { code: d.code, message: d.message, part: nameOf(d.partId), entities: entityHandles(d.partId, d.entityIds) };
    (d.severity === 'error' ? errors : warnings).push(issue);
  }
  const statuses = solved.sketches;
  const parts = solved.document.parts.map((part: CadPart): CadReportPart => {
    const evaluated = solved.parts.find(candidate => candidate.partId === part.id);
    const faces = cadFaceSketches(part);
    const statusesOf = statuses.filter(status => status.partId === part.id);
    const featureHandles = shortHandles((part.features ?? []).map(f => f.id));
    const sketchHandles = shortHandles(faces.map(face => face.sketch.id));
    const sketches = [
      { sketch: part.sketch, ref: 'profile', on: 'profile' as const },
      ...faces.map(face => ({
        sketch: face.sketch,
        ref: sketchHandles.get(face.sketch.id)!,
        on: typeof face.on === 'object' ? { floorOf: featureHandles.get(face.on.floorOf) ?? face.on.floorOf } : face.on,
      })),
    ].map(({ sketch, ref, on }, i) => ({
      ref,
      on,
      freedom: statusesOf[i]?.dof ?? null,
      status: statusesOf[i]?.status ?? 'invalid',
      entities: reportEntities(sketch),
      constraints: sketch.constraints.length,
    }));
    const cuts = (evaluated?.cuts ?? []).map(cut => {
      const { at, size } = bounds(cut.outline);
      return { ref: featureHandles.get(cut.id)!, side: cut.side, from: round(cut.from), to: round(cut.to), through: cut.through, at, size };
    });
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
    if (evaluated) {
      if (evaluated.cuts?.some(cut => cut.side === 'underside'))
        warnings.push({ code: 'cam-underside', message: 'Cuts on the underside can’t be machined yet.', part: part.name });
      else {
        const features = camFeatures(evaluated);
        cam = { pockets: features.pockets, throughHoles: features.throughHoles };
        if (features.outlines !== 1)
          errors.push({
            code: 'cam-split',
            message: 'These through cuts split the part. Use a separate part for each piece.',
            part: part.name,
          });
      }
    }
    const box = evaluated && bounds(evaluated.outline);
    const report: CadReportPart = {
      name: part.name,
      thickness: part.thickness,
      ...(box && { outline: { at: box.at, size: box.size } }),
      holes: evaluated?.holes.length,
      cuts,
      sketches,
      ...(cam && { cam }),
    };
    const freedom = sketches.reduce((sum, sketch) => sum + (sketch.freedom ?? 0), 0);
    for (const want of expectations.get(part.id) ?? [])
      for (const failure of checkExpectation(want, report, freedom))
        errors.push({ code: 'expect-failed', message: failure, part: part.name });
    return report;
  });
  return {
    document: solved.document,
    parts: solved.parts,
    report: { ok: solved.status === 'solved' && !errors.length, status: solved.status, errors, warnings, parts },
  };
}
