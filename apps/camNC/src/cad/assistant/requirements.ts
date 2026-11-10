import { cadCopyName, evaluatedPartCopy, type CadDocument, type CadPoint, type EvaluatedCadPart } from '@wbcnc/cad';
import { compactCadReport, type CadReport } from '@wbcnc/cad-script';

/** Confirmed application state. A generated script cannot replace or weaken these checks. All lengths are mm. */
export interface AssistantRequirements {
  part?: string;
  width?: number;
  height?: number;
  thickness?: number;
  pocketDepth?: number;
  minimumFloor?: number;
  minimumWall?: number;
  sourcePartCount?: number;
  holeCount?: number;
  pocketCount?: number;
  assemblyWidth?: number;
  assemblyDepth?: number;
  assemblyHeight?: number;
  preserveExistingIds?: boolean;
}
export interface AssistantRequirementCheck {
  requirement: string;
  passed: boolean;
  expected?: unknown;
  actual?: unknown;
  message?: string;
}
export const requirementLengths = [
  'width',
  'height',
  'thickness',
  'pocketDepth',
  'minimumFloor',
  'minimumWall',
  'assemblyWidth',
  'assemblyDepth',
  'assemblyHeight',
] as const;

export function validateAssistantRequirements(input: AssistantRequirements): AssistantRequirements {
  const allowed = new Set<string>(['part', 'sourcePartCount', 'holeCount', 'pocketCount', 'preserveExistingIds', ...requirementLengths]);
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.has(key)) throw new Error(`Unknown requirement: ${key}.`);
    if (value === undefined) continue;
    if (key === 'part') {
      if (typeof value !== 'string' || !value.trim() || value.length > 256)
        throw new Error('Enter a part name or ID, or leave the target blank.');
    } else if (key === 'preserveExistingIds') {
      if (typeof value !== 'boolean') throw new Error('Choose whether existing IDs must be preserved.');
    } else if (key === 'sourcePartCount' || key === 'holeCount' || key === 'pocketCount') {
      if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error('Counts must be non-negative integers.');
    } else if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1_000_000) {
      throw new Error(`${key} must be a positive finite length in mm.`);
    }
  }
  return structuredClone(input);
}

function ids(value: unknown): string[] {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(ids);
  return Object.entries(value).flatMap(([key, item]) => (key === 'id' && typeof item === 'string' ? [item] : ids(item)));
}
function pointSegment(point: CadPoint, a: CadPoint, b: CadPoint) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}
function segmentDistance(a: CadPoint, b: CadPoint, c: CadPoint, d: CadPoint) {
  const cross = (p: CadPoint, q: CadPoint, r: CadPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const x = cross(a, b, c),
    y = cross(a, b, d),
    u = cross(c, d, a),
    v = cross(c, d, b);
  if (x * y < 0 && u * v < 0) return 0;
  return Math.min(pointSegment(a, c, d), pointSegment(b, c, d), pointSegment(c, a, b), pointSegment(d, a, b));
}
function minimumWall(part: EvaluatedCadPart): number | undefined {
  const pockets = (part.cuts ?? []).filter(cut => !cut.through);
  if (!pockets.length || pockets.some(cut => cut.side !== 'top')) return;
  const count = pockets.reduce((sum, cut) => sum + cut.outline.length, 0) * part.outline.length;
  // Keep application-side validation bounded even for imported paths with many segments.
  if (count > 2_000_000 || part.outline.length < 3) return;
  let minimum = Infinity;
  for (const pocket of pockets)
    for (let i = 0; i < pocket.outline.length; i++)
      for (let j = 0; j < part.outline.length; j++)
        minimum = Math.min(
          minimum,
          segmentDistance(
            pocket.outline[i]!,
            pocket.outline[(i + 1) % pocket.outline.length]!,
            part.outline[j]!,
            part.outline[(j + 1) % part.outline.length]!
          )
        );
  return Number.isFinite(minimum) ? minimum : undefined;
}

export function checkAssistantRequirements(
  requirements: AssistantRequirements,
  base: CadDocument,
  document: CadDocument,
  report: CadReport,
  parts: readonly EvaluatedCadPart[]
): { ok: boolean; checks: AssistantRequirementCheck[] } {
  validateAssistantRequirements(requirements);
  const checks: AssistantRequirementCheck[] = [];
  const record = (requirement: string, passed: boolean, expected?: unknown, actual?: unknown, message?: string) =>
    checks.push({
      requirement,
      passed,
      ...(expected !== undefined && { expected }),
      ...(actual !== undefined && { actual }),
      ...(message && { message }),
    });
  const exact = (name: string, expected: number | undefined, actual: number | undefined) => {
    if (expected === undefined) return;
    record(name, actual !== undefined && Number.isFinite(actual) && Math.abs(actual - expected) <= 0.05, expected, actual ?? null);
  };
  const solids = report.parts.filter(part => part.outline);
  if (requirements.sourcePartCount !== undefined) exact('sourcePartCount', requirements.sourcePartCount, solids.length);
  if (requirements.preserveExistingIds) {
    const current = new Set(ids(document));
    const missing = ids(base).filter(id => !current.has(id));
    record('preserveExistingIds', missing.length === 0, 'all existing IDs', missing);
  }
  const assemblyLengths = [requirements.assemblyWidth, requirements.assemblyDepth, requirements.assemblyHeight];
  if (assemblyLengths.some(value => value !== undefined)) {
    const bodies = report.assembly?.parts ?? [];
    assemblyLengths.forEach((wanted, axis) =>
      exact(
        ['assemblyWidth', 'assemblyDepth', 'assemblyHeight'][axis]!,
        wanted,
        bodies.length
          ? Math.max(...bodies.map(body => body.at[axis]! + body.size[axis]!)) - Math.min(...bodies.map(body => body.at[axis]!))
          : undefined
      )
    );
  }
  if (
    ![
      requirements.width,
      requirements.height,
      requirements.thickness,
      requirements.pocketDepth,
      requirements.minimumFloor,
      requirements.minimumWall,
      requirements.holeCount,
      requirements.pocketCount,
    ].some(value => value !== undefined)
  )
    return { ok: checks.every(check => check.passed), checks };

  const compact = compactCadReport(document, report);
  const candidates = document.parts.flatMap((source, index) => {
    const target = report.parts[index];
    const evaluated = parts.find(part => part.partId === source.id);
    if (!target?.outline || !evaluated) return [];
    const entries = [{ id: source.id, names: [source.name, compact.parts[index]!.ref], target, evaluated }];
    for (const [copyIndex, copy] of (source.copies ?? []).entries()) {
      if (copy.suppressed) continue;
      entries.push({ id: copy.id, names: [cadCopyName(source, copyIndex)], target, evaluated: evaluatedPartCopy(evaluated, copy) });
    }
    return entries;
  });
  const exactId = requirements.part && candidates.filter(candidate => candidate.id === requirements.part);
  const matches =
    exactId && exactId.length
      ? exactId
      : candidates.filter(candidate =>
          requirements.part ? candidate.names.includes(requirements.part) : document.parts.some(source => source.id === candidate.id)
        );
  const selected = matches.length === 1 ? matches[0] : undefined;
  if (!selected) {
    record(
      'target',
      false,
      requirements.part ?? 'one outlined source part',
      candidates.map(candidate => candidate.names[0]),
      'Choose an unambiguous part name, ID or report handle for outline requirements.'
    );
    return { ok: false, checks };
  }
  const { target, evaluated } = selected;
  const actualSize = evaluated?.outline.length
    ? [
        Math.max(...evaluated.outline.map(point => point.x)) - Math.min(...evaluated.outline.map(point => point.x)),
        Math.max(...evaluated.outline.map(point => point.y)) - Math.min(...evaluated.outline.map(point => point.y)),
      ]
    : target.outline?.size;
  exact('width', requirements.width, actualSize?.[0]);
  exact('height', requirements.height, actualSize?.[1]);
  exact('thickness', requirements.thickness, evaluated?.thickness ?? target.thickness);
  const cuts = evaluated?.cuts ?? target.cuts;
  const pockets = cuts.filter(cut => !cut.through);
  exact(
    'holeCount',
    requirements.holeCount,
    evaluated ? evaluated.holes.length + cuts.filter(cut => cut.through).length : (target.cam?.throughHoles ?? target.holes)
  );
  exact('pocketCount', requirements.pocketCount, pockets.length);
  if (requirements.pocketDepth !== undefined) {
    record(
      'pocketDepth',
      pockets.length > 0 && pockets.every(cut => Math.abs(cut.to - cut.from - requirements.pocketDepth!) <= 0.05),
      requirements.pocketDepth,
      pockets.map(cut => cut.to - cut.from)
    );
  }
  if (requirements.minimumFloor !== undefined) {
    const sides = new Set(pockets.map(cut => cut.side));
    const floor =
      pockets.length && sides.size === 1 && !evaluated.holes.length && !cuts.some(cut => cut.through)
        ? (evaluated?.thickness ?? target.thickness) - Math.max(...pockets.map(cut => cut.to))
        : undefined;
    record(
      'minimumFloor',
      floor !== undefined && floor + 0.05 >= requirements.minimumFloor,
      requirements.minimumFloor,
      floor ?? null,
      floor === undefined
        ? 'A floor bound needs blind cuts from one side without through holes; opposed pockets and pierced floors need a separate material-thickness check.'
        : undefined
    );
  }
  if (requirements.minimumWall !== undefined) {
    const wall = evaluated && minimumWall(evaluated);
    record(
      'minimumWall',
      wall !== undefined && wall + 0.05 >= requirements.minimumWall,
      requirements.minimumWall,
      wall ?? null,
      wall === undefined ? 'Could not measure a bounded top-pocket wall from trusted evaluated contours.' : undefined
    );
  }
  return { ok: checks.every(check => check.passed), checks };
}
