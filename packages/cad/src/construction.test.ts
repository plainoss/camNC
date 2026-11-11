import { describe, expect, it } from 'vitest';
import {
  addCircle,
  createCadFolder,
  createCadPart,
  createPlateDocument,
  parseCadDocument,
  setCadVariable,
  setCutDepth,
  cadSketchRegions,
  type CadConstruction,
} from './index';
import { constructionReferenceIssues, removeCadConstruction, setCadConstruction } from './construction';
import { cadDocumentVersion } from './documentVersion';
import { validateCadDocument } from './geometry';

function fixture() {
  let document = createPlateDocument();
  const part = document.parts[0]!;
  part.sketch = addCircle(part.sketch, { x: 30, y: 30, radius: 2.25 });
  part.copies = [{ id: 'physical-copy', mirrored: true }];
  const grouped = createCadFolder(document, { id: 'furniture', name: 'Furniture', partIds: [part.id] });
  if ('error' in grouped) throw new Error(grouped.error);
  document = grouped.document;
  const variable = setCadVariable(document, { id: 'stock-variable', name: 'stock', expression: '18mm' });
  if ('error' in variable) throw new Error(variable.error);
  document = variable.document;
  const circle = part.sketch.entities.find(e => e.type === 'circle')!;
  const plan: CadConstruction = {
    id: 'construction',
    folderId: 'furniture',
    recipe: 'panel-chair-keyed-v1',
    parameters: [{ name: 'board', variableId: variable.id }],
    members: [{ role: 'key', partId: part.id, copyId: 'physical-copy' }],
    materials: [
      {
        roles: ['key'],
        kind: 'plywood',
        grain: 'profile-y',
        stock: 'measured',
        stockVariableId: variable.id,
        service: 'conditioned-dry-interior',
      },
    ],
    connections: [{ id: 'key-joint', kind: 'keyed-through-tenon', roles: ['key'], hardwareIds: ['key-bolt'] }],
    hardware: [
      {
        id: 'key-bolt',
        kind: 'key-locking-bolt',
        specification: 'M4 headed bolt, washers and prevailing-torque locknut',
        holes: [{ purpose: 'clearance', role: 'key', sketchId: part.sketch.id, entityIds: [circle.id] }],
        lengthVariableId: variable.id,
        diameter: 4,
        headDiameter: 7,
        headHeight: 4,
        washerDiameter: 12,
        washerThickness: 1,
        nutHeight: 5,
        minimumThreadProjection: 1.4,
        accessRadius: 8,
        accessLength: 40,
        installation: 'head-washers-prevailing-torque-nut',
      },
    ],
    assembly: [{ action: 'install-hardware', roles: ['key'], hardwareIds: ['key-bolt'], axis: '+z' }],
  };
  return { document, plan };
}

describe('durable construction source and compatibility', () => {
  it('opts only construction-bearing documents into v6 and preserves facts across JSON reload', () => {
    const { document, plan } = fixture();
    expect(document.version).toBe(3);
    const next = setCadConstruction(document, plan);
    expect(next.version).toBe(6);
    expect(document.constructions).toBeUndefined();
    expect(parseCadDocument(JSON.parse(JSON.stringify(next)))).toEqual(next);
    expect(validateCadDocument(next).filter(d => d.severity === 'error')).toEqual([]);
    expect(constructionReferenceIssues(next)).toEqual([]);
    const removed = removeCadConstruction(next, plan.id);
    expect(removed.version).toBe(3);
    expect(removed).not.toHaveProperty('constructions');
  });

  it('retains the ordinary minimum versions, including feature edits with a plan present', () => {
    const ordinary = createPlateDocument();
    expect(cadDocumentVersion(ordinary)).toBe(1);
    const { document, plan } = fixture();
    const part = document.parts[0]!;
    const region = cadSketchRegions(part, part.sketch.id).find(r => r.curveIds.length === 1)!;
    const plainPart = ordinary.parts[0]!;
    plainPart.sketch = addCircle(plainPart.sketch, { x: 30, y: 30, radius: 4 });
    const plainRegion = cadSketchRegions(plainPart, plainPart.sketch.id).find(r => r.curveIds.length === 1)!;
    const featured = setCutDepth(ordinary, plainPart.id, plainPart.sketch.id, plainRegion.id, 2);
    expect(cadDocumentVersion(featured)).toBe(2);
    expect(parseCadDocument(featured)).toEqual(featured);
    const withPlan = setCadConstruction(document, plan);
    expect(setCutDepth(withPlan, part.id, part.sketch.id, region.id, 3).version).toBe(6);
    const noPlan = removeCadConstruction(withPlan, plan.id);
    expect(cadDocumentVersion(noPlan)).toBe(3);
    expect(parseCadDocument(noPlan)).toEqual(noPlan);
    expect(() => parseCadDocument({ ...ordinary, version: 6 })).toThrow('Invalid CAD document');
  });

  it('preserves exact physical/circle/variable identities through renaming and reports missing references without blocking reopen', () => {
    const { document, plan } = fixture();
    const declared = setCadConstruction(document, plan);
    const renamed = setCadVariable(declared, { id: 'stock-variable', name: 'measuredBoard', expression: '19mm' });
    if ('error' in renamed) throw new Error(renamed.error);
    renamed.document.parts[0]!.name = 'A new display name';
    expect(constructionReferenceIssues(parseCadDocument(renamed.document))).toEqual([]);
    const removedCopy = structuredClone(renamed.document);
    delete removedCopy.parts[0]!.copies;
    const reopened = parseCadDocument(removedCopy);
    expect(reopened.version).toBe(6);
    expect(reopened.constructions).toEqual(declared.constructions);
    expect(constructionReferenceIssues(reopened).some(d => d.message.includes('physical member key'))).toBe(true);
    // A same-named source is not a substitute for the bound physical copy.
    reopened.parts[0]!.copies = [{ id: 'replacement-copy', name: 'A new display name' }];
    expect(constructionReferenceIssues(reopened).some(d => d.message.includes('physical member key'))).toBe(true);
    reopened.parts[0]!.sketch.entities = reopened.parts[0]!.sketch.entities.filter(e => e.type !== 'circle');
    expect(constructionReferenceIssues(parseCadDocument(reopened)).some(d => d.message.includes('hardware hole key-bolt'))).toBe(true);
  });

  it.each([null, {}, [null], Array(1), [{ recipe: 'unknown' }]])(
    'refuses malformed construction data before deriving a reader version: %j',
    constructions => {
      const { document } = fixture();
      expect(() => parseCadDocument({ ...document, version: 6, constructions })).toThrow('Invalid CAD construction');
    }
  );

  it('bounds collections, rejects stored pass claims and refuses under-versioned declarations', () => {
    const { document, plan } = fixture();
    expect(() => parseCadDocument({ ...document, version: 6, constructions: Array(33).fill(plan) })).toThrow('Invalid CAD construction');
    expect(() => parseCadDocument({ ...document, version: 6, constructions: [{ ...plan, passed: true }] })).toThrow(
      'Invalid CAD construction'
    );
    expect(() => parseCadDocument({ ...document, constructions: [plan] })).toThrow();
    expect(() => parseCadDocument({ ...document, version: 6, constructions: [] })).toThrow();
    for (const version of [4, 5]) expect(() => parseCadDocument({ ...document, version, constructions: [plan] })).toThrow();
  });

  it.each(['relief-off', 'relief-object'])('keeps a construction plan together with per-step corner relief at floor 6: %s', feature => {
    const { document, plan } = fixture();
    const planned = setCadConstruction(document, plan);
    const input = {
      ...planned,
      parts: [...planned.parts, { ...createCadPart('Tool', 6), id: 'relief-tool' }],
      partCuts: [
        {
          id: 'relief-cut',
          tools: ['relief-tool'],
          targets: [planned.parts[0]!.id],
          clearance: 0,
          cornerRelief: feature === 'relief-off' ? null : { diameter: 6 },
        },
      ],
    };
    expect(parseCadDocument(input).version).toBe(6);
    expect(validateCadDocument(input).filter(d => d.code === 'invalid-document')).toEqual([]);
  });

  it('preserves distinct physical mating-hole anchors and reports removal of either referenced mate', () => {
    const { document, plan } = fixture();
    plan.members.push({ role: 'seat', partId: document.parts[0]!.id });
    plan.hardware[0]!.holes.push({ ...plan.hardware[0]!.holes[0]!, purpose: 'pilot', role: 'seat' });
    const declared = setCadConstruction(document, plan);
    const reloaded = parseCadDocument(JSON.parse(JSON.stringify(declared)));
    expect(reloaded.constructions![0]!.hardware[0]!.holes.map(a => [a.purpose, a.role])).toEqual([
      ['clearance', 'key'],
      ['pilot', 'seat'],
    ]);
    expect(constructionReferenceIssues(reloaded)).toEqual([]);
    reloaded.constructions![0]!.hardware[0]!.holes[1]!.sketchId = 'removed-pilot-sketch';
    expect(constructionReferenceIssues(parseCadDocument(reloaded)).some(d => d.message.includes('(pilot)'))).toBe(true);
  });

  it.each(['empty', 'too-many', 'duplicate', 'duplicate-entity', 'purpose-array', 'purpose-object'])(
    'rejects malformed hardware anchors: %s',
    mutation => {
      const { document, plan } = fixture();
      const item = plan.hardware[0]!;
      if (mutation === 'empty') item.holes = [];
      if (mutation === 'too-many') item.holes = Array(5).fill(item.holes[0]);
      if (mutation === 'duplicate') item.holes.push({ ...item.holes[0]!, purpose: 'pilot' });
      if (mutation === 'duplicate-entity') item.holes[0]!.entityIds.push(item.holes[0]!.entityIds[0]!);
      if (mutation.startsWith('purpose'))
        (item.holes[0] as unknown as Record<string, unknown>).purpose = mutation === 'purpose-array' ? ['clearance'] : { toString: null };
      expect(() => parseCadDocument({ ...document, version: 6, constructions: [plan] })).toThrow('Invalid CAD construction plans');
    }
  );

  it.each([
    ['recipe', 'panel-chair-keyed-v1'],
    ['material', 'plywood'],
    ['grain', 'profile-y'],
    ['stock', 'measured'],
    ['connection', 'keyed-through-tenon'],
    ['hardware', 'key-locking-bolt'],
    ['installation', 'head-washers-prevailing-torque-nut'],
    ['assembly', 'install-hardware'],
  ])('rejects coercible %s enums with a plain validation error', (field, label) => {
    for (const value of [[label], { toString: null }]) {
      const { document, plan } = fixture();
      const target = plan as unknown as Record<string, unknown>;
      if (field === 'recipe') target.recipe = value;
      else if (field === 'material') (plan.materials[0] as unknown as Record<string, unknown>).kind = value;
      else if (field === 'grain' || field === 'stock') (plan.materials[0] as unknown as Record<string, unknown>)[field] = value;
      else if (field === 'connection') (plan.connections[0] as unknown as Record<string, unknown>).kind = value;
      else if (field === 'hardware') (plan.hardware[0] as unknown as Record<string, unknown>).kind = value;
      else if (field === 'installation') (plan.hardware[0] as unknown as Record<string, unknown>).installation = value;
      else (plan.assembly[0] as unknown as Record<string, unknown>).action = value;
      let caught: unknown;
      try {
        parseCadDocument({ ...document, version: 6, constructions: [plan] });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      expect((caught as Error).constructor).toBe(Error);
      expect((caught as Error).message).toBe('Invalid CAD construction plans');
    }
  });
});
