import { assemblyReport, createCadDocument, createPlateDocument, evaluateCadDocument, parseCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { cadTaskFamilyMaterial } from '../../../../../packages/cad-script/src/tasks/material';
import cupboardJson from '../../../../../packages/cad-script/fixtures/designs/task-start-cupboard-three-shelves.json?raw';
import { createAssistantScriptSession } from './scriptSession';
import { checkScriptInBrowser } from './scriptCheck';

it('checks recipe parameters as editable CAD without leaking folder names into executable code', async () => {
  const base = createCadDocument();
  const original = structuredClone(base);
  const session = createAssistantScriptSession(base);
  const folderName = 'Tray "); throw new Error("injected"); //';
  const script = await session.resolve({
    recipe: 'pebble-tray',
    parameters: { width: 240, height: 160, blank: 30, pocketDepth: 20, wall: 12, folderName, at: [450, 0, 0] },
  });
  const checked = await checkScriptInBrowser(base, script.source);
  expect(checked.scriptError).toBeUndefined();
  expect(checked.ok).toBe(true);
  expect(checked.document.folders?.[0]?.name).toBe(folderName);
  const part = checked.report.parts.find(part => part.outline)!;
  expect(part.outline?.size).toEqual([240, 160]);
  expect(part.thickness).toBe(30);
  expect(part.cuts[0]).toMatchObject({ through: false, from: 0, to: 20, size: [216, 136] });
  // Assembly boxes use tessellated curves; the authored placement itself remains exact.
  expect(checked.document.parts[0]?.placement?.position).toEqual([450, 0, 0]);
  const resized = await checkScriptInBrowser(
    checked.document,
    `d => d.existingFolder(${JSON.stringify(folderName)}, s => { s.variable('width', '300mm'); s.variable('wall', '15mm'); })`
  );
  expect(resized.ok).toBe(true);
  expect(resized.document.parts[0]?.id).toBe(checked.document.parts[0]?.id);
  expect(resized.report.parts[0]?.outline?.size).toEqual([300, 160]);
  expect(resized.report.parts[0]?.cuts[0]?.size).toEqual([270, 130]);
  expect(base).toEqual(original);
}, 60_000);

it('inserts a cupboard recipe beside saved work and satisfies independent A3 outcomes', async () => {
  const base = parseCadDocument(JSON.parse(cupboardJson));
  const original = structuredClone(base);
  const session = createAssistantScriptSession(base);
  const script = await session.resolve({
    recipe: 'cupboard',
    parameters: { width: 400, height: 900, depth: 300, board: 18, shelves: 3, folderName: 'Second cupboard', at: [800, 0, 0] },
  });
  const checked = await checkScriptInBrowser(base, script.source);
  expect(checked.scriptError).toBeUndefined();
  expect(checked.ok).toBe(true);
  const originalIds = new Set(base.parts.map(part => part.id));
  const before = evaluateCadDocument(base);
  // Folder-scoped part names may repeat: distinguish old/new geometry by persistent identity.
  for (const source of base.parts) {
    const oldPart = before.parts.find(part => part.partId === source.id)!;
    const currentPart = checked.parts!.find(part => part.partId === source.id)!;
    expect(currentPart).toBeDefined();
    expect(cadTaskFamilyMaterial(source, currentPart)).toEqual(cadTaskFamilyMaterial(source, oldPart));
    expect(checked.document.parts.find(part => part.id === source.id)).toEqual(source);
  }
  const added = checked.document.parts.filter(part => !originalIds.has(part.id));
  expect(added.length).toBeGreaterThan(0);
  expect(checked.document.folders?.find(folder => folder.name === 'Second cupboard')).toBeDefined();
  const bodies = assemblyReport({ ...checked.document, parts: added }, checked.parts!)!.parts;
  const low = [0, 1, 2].map(axis => Math.min(...bodies.map(body => body.at[axis]!)));
  const high = [0, 1, 2].map(axis => Math.max(...bodies.map(body => body.at[axis]! + body.size[axis]!)));
  expect(low).toEqual([800, 0, 0]);
  expect(high.map((value, axis) => value - low[axis]!)).toEqual([400, 300, 900]);
  const oldBodies = assemblyReport(base, before.parts)!.parts;
  expect(Math.max(...oldBodies.map(body => body.at[0]! + body.size[0]!))).toBe(800);
  expect(checked.report.assembly?.collisions).toEqual([]);
  expect(base).toEqual(original);
}, 60_000);

it('repairs a checked script using its hash while every attempt starts from the same original document', async () => {
  const base = createPlateDocument();
  const session = createAssistantScriptSession(base);
  const script = await session.resolve({ source: 'd => { d.part("Plate").thickness(30); }' });
  const first = await checkScriptInBrowser(structuredClone(base), script.source);
  expect(first.ok).toBe(true);
  const repaired = await session.resolve({
    scriptId: script.scriptId,
    expectedHash: script.hash,
    patches: [{ oldText: '.thickness(30)', newText: '.thickness(24)' }],
  });
  const second = await checkScriptInBrowser(structuredClone(base), repaired.source);
  expect(second.ok).toBe(true);
  expect(second.document.parts[0]?.thickness).toBe(24);
  expect(second.document.parts[0]?.id).toBe(base.parts[0]?.id);
  expect(base.parts[0]?.thickness).toBe(18);
  expect(first.document.parts[0]?.thickness).toBe(30);
}, 30_000);
