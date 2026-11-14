import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  constructionReferenceIssues,
  parseCadDocument,
  setCadVariable,
  solveCadDocumentNow,
  type CadConstruction,
  type CadDocument,
} from '@wbcnc/cad';
import { editCad, type CadEditResult } from './edit';
import { frameStool } from './frameStool';
import { checkFurnitureConstruction } from './furnitureJoints';
import { inspectCadDocument } from './inspect';
import { assessCadTask } from './tasks/assess';
import { cadSavedTask } from './tasks/catalogue';

const failing = (document: CadDocument, plan: CadConstruction) => {
  const solved = solveCadDocumentNow(document);
  return checkFurnitureConstruction(solved.document, solved.parts, plan).filter(c => !c.passed);
};
const withVariable = (document: CadDocument, name: string, expression: string) => {
  const variable = document.variables!.find(v => v.name === name)!;
  const changed = setCadVariable(document, { id: variable.id, name, expression });
  if ('error' in changed) throw new Error(changed.error);
  return changed.document;
};

// Each measured check also sweeps the whole assembly order, a few seconds per check under a parallel run.
describe('frame stool pattern', { timeout: 90_000 }, () => {
  let result: CadEditResult, reloaded: CadDocument, plan: CadConstruction;
  beforeAll(async () => {
    result = await editCad(null, frameStool());
    reloaded = parseCadDocument(JSON.parse(JSON.stringify(result.document)));
    plan = reloaded.constructions![0]!;
  }, 180_000);

  it('builds laminated legs, shouldered rail tenons and a screwed seat that pass the measured checks', () => {
    expect(result.scriptError).toBeUndefined();
    expect(result.report.errors).toEqual([]);
    expect(result.report.assembly?.collisions).toEqual([]);
    const bodies = result.report.assembly!.parts;
    expect(bodies).toHaveLength(19);
    for (const [axis, size] of [360, 360, 650].entries()) {
      expect(Math.min(...bodies.map(b => b.at[axis]!))).toBeCloseTo(axis === 2 ? 0 : -10, 6);
      expect(Math.max(...bodies.map(b => b.at[axis]! + b.size[axis]!))).toBeCloseTo(axis === 2 ? size : size - 10, 6);
    }
    expect(constructionReferenceIssues(reloaded)).toEqual([]);
    expect(plan.recipe).toBe('frame-stool-glued-v1');
    expect(plan.connections.filter(c => c.kind === 'glued-shouldered-tenon')).toHaveLength(20);
    expect(plan.connections.filter(c => c.kind === 'glued-lamination')).toHaveLength(4);
    expect(plan.hardware).toHaveLength(4);
    expect(plan.adhesive?.kind).toBe('PVA-wood-glue');
    const checks = checkFurnitureConstruction(result.document, result.parts, plan);
    expect(checks.filter(c => !c.passed)).toEqual([]);
    // Every rail end measures its actual engagement, shoulders, closed mortise and machined opening.
    expect(checks.filter(c => c.check.includes('engages its receivers'))).toHaveLength(20);
    const webs = checks.filter(c => c.check.includes('keep a web'));
    expect(webs.length).toBeGreaterThan(0);
    expect(Math.min(...webs.map(c => c.actual!))).toBeGreaterThanOrEqual(5);
    expect(failing(reloaded, plan)).toEqual([]);
    // Purchased screws are not wooden blanks.
    expect(result.report.parts.map(p => p.name)).not.toContain('seat-screw');
  });

  it('refuses shallow tenons and full-section rail ends after an edit', () => {
    expect(failing(withVariable(reloaded, 'engagement', '10mm'), plan).some(c => c.check.includes('engages its receivers'))).toBe(true);
    expect(failing(withVariable(reloaded, 'shoulder', '4mm'), plan).some(c => c.check.includes('Shoulders'))).toBe(true);
  });

  it('refuses perpendicular mortises that cut into each other', () => {
    const deep = failing(withVariable(reloaded, 'engagement', '36mm'), plan);
    expect(deep.some(c => c.check.includes('keep a web'))).toBe(true);
  });

  it('refuses a suppressed mortise step and a seat screw too short to engage', () => {
    const suppressed = structuredClone(reloaded);
    const legs = suppressed.partCuts!.find(c => c.targets.length === 8)!;
    legs.suppressed = true;
    expect(failing(suppressed, plan).some(c => c.check.includes('actually cut away'))).toBe(true);
    expect(failing(withVariable(reloaded, 'screwLength', '30mm'), plan).some(c => c.check.includes('engages the receiving member'))).toBe(
      true
    );
  });

  it('refuses a seat with no fastened attachment', () => {
    const loose = structuredClone(plan);
    loose.connections = loose.connections.filter(c => c.kind !== 'seat-attachment');
    expect(failing(reloaded, loose).some(c => c.check.includes('positive fastened attachment'))).toBe(true);
  });

  it('counts only a measured construction as a completed stool task', async () => {
    const response = 'Proposal: 650 mm frame stool with shouldered mortise-and-tenon rails and a screwed seat.';
    const assess = (candidate: CadEditResult) =>
      assessCadTask(cadSavedTask('stool'), null, candidate, response).checks.find(c => c.description.includes('retained construction'))!;
    expect(assess(result).passed).toBe(true);
    // The same geometry without its construction plan, and the original loose stool in a stool folder, both fail.
    const unplanned = structuredClone(result.document);
    delete unplanned.constructions;
    expect(assess({ ...result, document: unplanned }).passed).toBe(false);
    const original = JSON.parse(
      await readFile(new URL('../fixtures/designs/furniture-original-frame-stool.json', import.meta.url), 'utf8')
    );
    const foldered = await editCad(parseCadDocument(original), d => {
      d.folder('Stool', () => {});
    });
    expect(assess(foldered).passed).toBe(false);
  }, 120_000);

  it('refuses a rail whose shoulder stops short of the leg', () => {
    const gapped = structuredClone(reloaded);
    const apron = gapped.parts.find(p => p.name === 'Front apron')!;
    apron.placement!.position[0] += 5;
    delete apron.placement!.positionExpressions;
    const failures = failing(gapped, plan).filter(c => c.id.endsWith('front-apron-front-left'));
    expect(failures.some(c => c.check.includes('shoulders meet the receiver face'))).toBe(true);
  });

  it('refuses a plan that leaves out its joints', () => {
    const partial = structuredClone(plan);
    partial.connections = partial.connections.filter(c => c.kind === 'seat-attachment');
    const failures = failing(reloaded, partial);
    expect(failures.some(c => c.check.includes('tenoned at both ends'))).toBe(true);
    expect(failures.some(c => c.check.includes('lamination is bonded'))).toBe(true);
  });

  // One test per stock: together they solve for over a minute without an event-loop turn, which starves Vitest's
  // worker RPC past its 60 s deadline and fails the run with every test passing.
  it.each(['16mm', '22mm'])(
    'keeps the allowed %s rail stock sound',
    async board => {
      const thick = await editCad(null, frameStool({ board }));
      expect(thick.report.errors).toEqual([]);
    },
    90_000
  );

  it('refuses a loose mortise and a stance edited past the pattern bound', () => {
    expect(failing(withVariable(reloaded, 'fit', '1mm'), plan).some(c => c.check.includes('glue line'))).toBe(true);
    expect(failing(withVariable(reloaded, 'height', '900mm'), plan).some(c => c.check.includes('half the seat height'))).toBe(true);
  });

  it('leaves a plan in a switched-off folder unmeasured', async () => {
    const parked = { ...reloaded, folders: reloaded.folders!.map(folder => ({ ...folder, suppressed: true as const })) };
    const { report } = await inspectCadDocument(parked, new Map(), { toolpaths: false });
    expect(report.errors.filter(error => error.code === 'construction-check')).toEqual([]);
  }, 60_000);

  it('relieves the mortises for their own wider cutter, so the deepest is at most 4 times its diameter', () => {
    const relieved = reloaded.parts.filter(part => part.cornerRelief);
    expect(relieved.length).toBeGreaterThan(0);
    expect(relieved.every(part => part.cornerRelief!.diameter === 6 && part.cornerRelief!.diameterExpression === 'mortiseCutter')).toBe(
      true
    );
    const deepest = Math.max(...result.parts.flatMap(part => (part.cuts ?? []).filter(cut => !cut.through).map(cut => cut.to - cut.from)));
    expect(deepest).toBeGreaterThan(20);
    expect(deepest).toBeLessThanOrEqual(4 * 6 + 0.5);
  });

  it('refuses a cutter too wide for the seat-screw pilots', async () => {
    expect((await editCad(null, frameStool({ cutter: '4mm' }))).scriptError).toContain('cutter up to 3.4 mm');
    expect((await editCad(null, frameStool({ board: '16mm', mortiseCutter: '10mm' }))).scriptError).toContain('mortise cutter');
  });

  it('refuses layouts that cannot hold the pattern', async () => {
    expect((await editCad(null, frameStool({ legLayer: '25mm' }))).scriptError).toContain('frame-stool pattern needs');
    expect((await editCad(null, frameStool({ footrestHeight: '150mm', footrestZ: '290mm' }))).scriptError).toContain(
      'frame-stool pattern needs'
    );
    expect((await editCad(null, frameStool({ width: '320mm', depth: '320mm', height: '700mm' }))).scriptError).toContain(
      'half the seat height'
    );
  });
});
