import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { assemblyReport, cadPartsToCut, parseCadDocument, solveCadDocument } from './index';

const saved = () =>
  parseCadDocument(
    JSON.parse(readFileSync(new URL('../../cad-script/fixtures/designs/finger-joint-face-sketch.json', import.meta.url), 'utf8'))
  );

it.each([2, 3, 5, 8])('makes %i fingers from the original face sketch without changing either extrusion', async fingers => {
  const document = saved();
  document.partCuts![0]!.split = { fingers };
  const source = structuredClone(document.parts);
  const solved = await solveCadDocument(document);
  expect(solved.status).toBe('solved');
  expect(solved.diagnostics.filter(diagnostic => diagnostic.code === 'part-cut-unresolved')).toEqual([]);
  expect(solved.parts.map(part => part.cuts?.length)).toEqual([Math.ceil(fingers / 2), Math.floor(fingers / 2)]);
  expect(solved.parts[0]!.cuts!.every(cut => cut.through && cut.to === 18)).toBe(true);
  for (const cut of solved.parts[1]!.cuts!) {
    expect(cut).toMatchObject({ side: 'underside', through: false, from: 0 });
    expect(cut.to).toBeCloseTo(18.2);
  }
  expect(solved.document.parts.map(part => [part.drawnOn, part.thickness])).toEqual(source.map(part => [part.drawnOn, part.thickness]));
  expect(cadPartsToCut(solved.document, solved.parts).map(entry => entry.part.name)).toEqual(['Part 2', 'Part 3']);
  expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
});

it('keeps the face-extruded board connected when the tool and target are exchanged', async () => {
  const document = saved();
  const step = document.partCuts![0]!;
  [step.tools, step.targets] = [step.targets, step.tools];
  const solved = await solveCadDocument(document);
  expect(solved.parts.map(part => part.cuts?.length)).toEqual([2, 3]);
  expect(solved.parts[1]!.cuts!.every(cut => !cut.through)).toBe(true);
  expect(assemblyReport(solved.document, solved.parts)!.collisions).toEqual([]);
});
