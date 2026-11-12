import { expect, it } from 'vitest';
import { constructionReferenceIssues, parseCadDocument } from '@wbcnc/cad';
import { editCad, type CadRef } from './edit';
import type { ScriptConstruction } from './constructionApi';

function declaration(folderId: string, member: CadRef, sketchId: string, hole: string): ScriptConstruction {
  return {
    folderId,
    recipe: 'panel-chair-keyed-v1',
    parameters: [{ name: 'board', variable: 'stock' }],
    members: [{ role: 'key', member }],
    materials: [
      {
        roles: ['key'],
        kind: 'plywood',
        grain: 'profile-y',
        stock: 'nominal',
        stockVariable: 'stock',
        service: 'conditioned-dry-interior',
      },
    ],
    connections: [{ id: 'joint', kind: 'keyed-through-tenon', roles: ['key'], hardwareIds: ['bolt'] }],
    hardware: [
      {
        id: 'bolt',
        kind: 'key-locking-bolt',
        specification: 'M4 headed bolt, washers and prevailing-torque nut',
        holes: [{ purpose: 'clearance', role: 'key', sketchId, entityIds: [hole] }],
        lengthVariable: 'boltLength',
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
    assembly: [{ action: 'install-hardware', roles: ['key'], hardwareIds: ['bolt'], axis: '+z' }],
  };
}

it('binds scoped variables and exact mirrored physical copies without alias or identity leakage', async () => {
  const result = await editCad(null, d => {
    d.variable('stock', '9mm');
    d.variable('boltLength', '99mm');
    for (const [name, thickness, x] of [
      ['First', '18mm', 0],
      ['Second', '21mm', 100],
    ] as const) {
      let member: CadRef,
        sketchId = '',
        hole = '';
      const folder = d.folder(name, scope => {
        scope.variable('stock', thickness);
        scope.variable('boltLength', '30mm');
        const part = scope.newPart('Key', { thickness: 'stock' });
        part.profile.rect({ at: [0, 0], w: 40, h: 60 });
        hole = part.profile.circle({ at: [20, 20], d: 4.5 }).id;
        sketchId = part.profile.id;
        part.place({ at: [x, 0, 0] });
        member = part.copy({ at: [x + 40, 0, 30], mirrored: true });
      });
      d.existingFolder(folder.id, scope => scope.construction(declaration(folder.id, member!, sketchId, hole)));
    }
  });
  expect(result.scriptError).toBeUndefined();
  // These persistence-only plans name a bare key, not a measured joint, so only construction checks may fail.
  expect(result.report.errors.length).toBeGreaterThan(0);
  expect(result.report.errors.every(error => error.code === 'construction-check')).toBe(true);
  const reloaded = parseCadDocument(JSON.parse(JSON.stringify(result.document)));
  expect(reloaded.version).toBe(6);
  expect(constructionReferenceIssues(reloaded)).toEqual([]);
  expect(reloaded.constructions).toHaveLength(2);
  for (const [index, plan] of reloaded.constructions!.entries()) {
    const variable = reloaded.variables!.find(v => v.id === plan.parameters[0]!.variableId)!;
    expect(variable.expression).toBe(index === 0 ? '18mm' : '21mm');
    expect(variable.folderId).toBe(plan.folderId);
    expect(plan.materials[0]!.stockVariableId).toBe(variable.id);
    expect(reloaded.variables!.find(v => v.id === plan.hardware[0]!.lengthVariableId)?.expression).toBe('30mm');
    expect(plan.members[0]!.copyId).toBe(reloaded.parts[index]!.copies![0]!.id);
    expect(plan.members[0]!.partId).toBe(reloaded.parts[index]!.id);
    expect(plan.connections[0]!.hardwareIds).toEqual([plan.hardware[0]!.id]);
  }
  expect(new Set(reloaded.constructions!.flatMap(p => [p.id, ...p.hardware.map(h => h.id), ...p.connections.map(c => c.id)])).size).toBe(6);
  const foreign = reloaded.parts[0]!;
  const refused = await editCad(reloaded, d =>
    d.existingFolder('Second', scope =>
      scope.construction(
        declaration(
          reloaded.folders![1]!.id,
          { id: `${foreign.id}:${foreign.copies![0]!.id}` },
          foreign.sketch.id,
          foreign.sketch.entities.find(e => e.type === 'circle')!.id
        )
      )
    )
  );
  expect(refused.scriptError).toContain('not in this folder');
  expect(refused.document).toEqual(reloaded);
});

it('refuses a folder replacing another folder’s plan by its ID', async () => {
  const result = await editCad(null, d => {
    d.variable('stock', '18mm');
    d.variable('boltLength', '30mm');
    for (const name of ['First', 'Second']) {
      d.folder(name, scope => {
        const part = scope.newPart('Key', { thickness: 'stock' });
        part.profile.rect({ at: [0, 0], w: 40, h: 60 });
        part.profile.circle({ at: [20, 20], d: 4.5 });
      });
    }
  });
  const document = result.document;
  const member = (folder: number) => {
    const part = document.parts.find(p => document.folders![folder]!.partIds.includes(p.id))!;
    return { part, hole: part.sketch.entities.find(e => e.type === 'circle')!.id };
  };
  const first = member(0);
  const declared = await editCad(document, d =>
    d.existingFolder('First', scope =>
      scope.construction({ ...declaration(document.folders![0]!.id, { id: first.part.id }, first.part.sketch.id, first.hole), id: 'plan' })
    )
  );
  expect(declared.scriptError).toBeUndefined();
  const second = member(1);
  const refused = await editCad(declared.document, d =>
    d.existingFolder('Second', scope =>
      scope.construction({
        ...declaration(document.folders![1]!.id, { id: second.part.id }, second.part.sketch.id, second.hole),
        id: 'plan',
      })
    )
  );
  expect(refused.scriptError).toContain('belongs to another folder');
  expect(refused.document).toEqual(declared.document);
});

it('rolls malformed declarations back as script errors without changing source', async () => {
  const base = await editCad(null, d => d.newPart('Panel').profile.rect({ at: [0, 0], w: 100, h: 80 }));
  for (const malformed of [null, {}, { members: [null] }, { parameters: Array(65).fill({}) }]) {
    const result = await editCad(base.document, d => d.construction(malformed as never));
    expect(result.scriptError).toBeTruthy();
    expect(result.document).toEqual(base.document);
  }
});
