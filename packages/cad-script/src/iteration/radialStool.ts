import { activeDesign, cadCopyName, type CadPlacement, type EvaluatedCadPart } from '@wbcnc/cad';
import { check, identityChecks, loadWoodworkingSource, sourceOwners, sourcePart, sourceVariable } from './woodworkingChecks';
import { radialStoolExpected, radialStoolProfiles, type RadialStoolIntent } from './radialStoolExpected';
import type { CadWorkflow, WorkflowCheckpoint, WorkflowContext } from './workflow';

/** Independent quaternion application for measuring evaluator output, never for expected recipe coordinates. */
function world(at: CadPlacement, p: number[]) {
  const [x, y, z, w] = at.rotation,
    tx = 2 * (y * p[2]! - z * p[1]!),
    ty = 2 * (z * p[0]! - x * p[2]!),
    tz = 2 * (x * p[1]! - y * p[0]!);
  return [
    at.position[0] + p[0]! + w * tx + y * tz - z * ty,
    at.position[1] + p[1]! + w * ty + z * tx - x * tz,
    at.position[2] + p[2]! + w * tz + x * ty - y * tx,
  ];
}

function material(part: EvaluatedCadPart, at: CadPlacement) {
  // This fixture promises uncut prisms. Reject cuts rather than reporting a misleading stock volume.
  if (!uncut(part)) throw new Error('Radial stool material requires its uncut source and copy profiles.');
  const outline = part.outline,
    volume =
      (Math.abs(
        outline.reduce((sum, a, i) => {
          const b = outline[(i + 1) % outline.length]!;
          return sum + a.x * b.y - a.y * b.x;
        }, 0)
      ) *
        part.thickness) /
      2,
    points = outline.flatMap(p => [world(at, [p.x, p.y, 0]), world(at, [p.x, p.y, part.thickness])]),
    low = [0, 1, 2].map(axis => Math.min(...points.map(p => p[axis]!))),
    high = [0, 1, 2].map(axis => Math.max(...points.map(p => p[axis]!))),
    localCenter = [
      (Math.min(...outline.map(p => p.x)) + Math.max(...outline.map(p => p.x))) / 2,
      (Math.min(...outline.map(p => p.y)) + Math.max(...outline.map(p => p.y))) / 2,
      part.thickness / 2,
    ],
    center = world(at, localCenter),
    origin = world(at, [0, 0, 0]),
    direction = (p: number[]) => world(at, p).map((value, i) => value - origin[i]!);
  return { at: low, size: high.map((value, i) => value - low[i]!), center, x: direction([1, 0, 0]), y: direction([0, 1, 0]), volume };
}

function uncut(part: EvaluatedCadPart) {
  return !part.holes.length && !part.cuts?.length && !Object.values(part.copyCuts ?? {}).some(cuts => cuts.length);
}

function actualBodies(context: WorkflowContext) {
  return activeDesign(context.document).parts.flatMap(source => {
    const part = context.parts.find(p => p.partId === source.id);
    if (!part || !source.placement) throw new Error(`Missing evaluated placed part ${source.name}.`);
    return [
      { name: source.name, ...material(part, source.placement) },
      ...(source.copies ?? []).map((copy, i) => {
        if (!copy.placement) throw new Error(`Missing radial copy placement ${copy.id}.`);
        return { name: cadCopyName(source, i), ...material(part, copy.placement) };
      }),
    ];
  });
}

/** A full seat and all its legs remain present while circular placement and lifecycle edits regenerate. */
export function radialStoolWorkflow(): CadWorkflow {
  let owners: Record<string, string> = {},
    patternId = '';
  const states: { id: string; intent: RadialStoolIntent; edit?: WorkflowCheckpoint['edit']; reload?: boolean }[] = [];
  let intent: RadialStoolIntent = { board: 18, radius: 150, legs: 4, height: 400, opposite: false, suppressed: false };
  const state = (id: string, edit?: WorkflowCheckpoint['edit'], reload?: boolean) =>
    states.push({ id, intent: { ...intent }, edit, reload });
  const editPattern = (field: 'opposite' | 'suppressed', value: boolean) => (d: WorkflowContext['document']) => {
    const pattern = sourcePart(d, 'Leg').pattern!;
    if (field === 'opposite') pattern.circular!.opposite = value;
    else if (value) pattern.suppressed = true;
    else delete pattern.suppressed;
    d.revision++;
    return d;
  };
  state('assembled');
  intent = { ...intent, board: 21, radius: 170 };
  state('resize-stock-and-radius', d => sourceVariable(sourceVariable(d, 'board', '21mm'), 'radius', '170mm'));
  intent = { ...intent, legs: 6 };
  state('grow-leg-count', d => sourceVariable(d, 'legs', '6'));
  intent = { ...intent, opposite: true };
  state('reverse-pattern', editPattern('opposite', true));
  intent = { ...intent, suppressed: true };
  state('suppress-pattern', editPattern('suppressed', true));
  intent = { ...intent, suppressed: false };
  state('restore-and-reload', editPattern('suppressed', false), true);
  return {
    id: 'radial-stool-regeneration',
    name: 'Dodecagonal stool seat and circularly patterned upright legs',
    async create() {
      const document = await loadWoodworkingSource('radial-stool');
      owners = sourceOwners(document);
      patternId = sourcePart(document, 'Leg').pattern!.id;
      return document;
    },
    checkpoints: states.map(s => {
      const expected = radialStoolExpected(s.intent),
        names = expected.map(p => p.name).sort();
      return {
        id: s.id,
        edit: s.edit,
        reload: s.reload,
        checks: [
          ...identityChecks(() => owners, { part: 'Leg', id: () => patternId, count: s.intent.legs }),
          check('solver', 'The stool sketches remain fully constrained.', [], ({ report }) => report.warnings.map(w => w.code).sort()),
          check('source', 'Circular source intent, expression links and selected world axis survive every edit.', true, ({ document }) => {
            const leg = sourcePart(document, 'Leg'),
              p = leg.pattern!,
              c = p.circular;
            return (
              !!c &&
              p.count === s.intent.legs &&
              p.countExpression === 'legs' &&
              c.angle === 360 &&
              c.equalSpacing !== false &&
              !!c.opposite === s.intent.opposite &&
              !!p.suppressed === s.intent.suppressed &&
              c.origin.join() === '0,0,0' &&
              c.axis.join() === '0,0,1' &&
              leg.thicknessExpression === 'board' &&
              !!leg.moved &&
              'by' in leg.moved &&
              leg.moved.byExpressions?.join() === 'radius,board/2,'
            );
          }),
          check('geometry', 'Every source and physical copy retains uncut occupied material.', true, ({ parts }) => parts.every(uncut)),
          check(
            'geometry',
            'The seat and leg retain their independently specified complete local contours.',
            radialStoolProfiles(s.intent.height),
            ({ parts }) =>
              parts.map(p => ({ name: p.name, points: p.outline.map(v => [v.x, v.y]).sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!) })),
            0.00001
          ),
          check(
            'assembly',
            'Every expected seat and leg occupies its intended bounds, center, orientation and uncut volume.',
            expected,
            actualBodies,
            0.002
          ),
          check(
            'assembly',
            'The legs touch the seat without overlapping occupied material.',
            [],
            ({ report }) => report.assembly?.collisions ?? null
          ),
          check('cam', 'All intended physical stool pieces reach the cutting handoff exactly once.', names, ({ report }) =>
            report.parts.flatMap(p => (p.pieces ? [...p.pieces.names, ...p.pieces.mirrored] : [p.name])).sort()
          ),
        ],
      };
    }),
  };
}
