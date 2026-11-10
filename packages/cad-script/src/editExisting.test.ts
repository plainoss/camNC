import { readFile } from 'node:fs/promises';
import { parseCadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { designSteps } from '@wbcnc/cad';
import { editCad } from './edit';
import { compactCadReport } from './compactReport';

const panel = () =>
  editCad(null, d => {
    d.variable('width', '100mm');
    d.variable('unused', '10mm');
    const part = d.newPart('Panel', { thickness: 18 });
    part.profile.rect({ at: [0, 0], w: 'width', h: 80 });
    const sketch = part.sketchOn('top');
    sketch.circle({ at: [30, 30], d: 10 });
    part.cut(sketch.regionAt(30, 30), { depth: 3 });
    part.copy({ at: [0, 0, 40], name: 'Upper panel' });
  });

describe('editing existing design entities', () => {
  it('refuses a missing part without adding an empty one', async () => {
    const start = await panel();
    const result = await editCad(start.document, d => {
      d.variable('unused', '20mm');
      d.part('Shelf 2');
    });
    expect(result.scriptError).toMatch(/no part/);
    expect(result.document).toEqual(start.document);
  });
  it('refuses duplicate explicit creation', async () => {
    const start = await panel();
    const result = await editCad(start.document, d => {
      d.newPart('Panel');
    });
    expect(result.scriptError).toMatch(/already a part/);
    expect(result.document).toEqual(start.document);
  });
  it('changes a numbered cut depth while keeping its ID and accepts a step handle', async () => {
    const start = await panel();
    const cut = start.document.parts[0]!.features!.find(feature => feature.type === 'cut')!;
    const result = await editCad(start.document, d => {
      d.part('Panel').existingCut(cut.id.slice(0, 8)).depth(6);
      d.step(cut.id).set({ suppressed: true });
      d.step(cut.id).set({ suppressed: false });
    });
    expect(result.ok).toBe(true);
    expect(result.document.parts[0]!.features!.find(feature => feature.id === cut.id)).toMatchObject({ id: cut.id, depth: 6 });
    expect(result.report.parts[0]!.cuts[0]!.to).toBe(6);
  });
  it('finds named copies without creating parts and removes independent copies', async () => {
    const start = await panel();
    const result = await editCad(start.document, d => {
      const copy = d.existingCopy('Upper panel');
      expect(d.existingCopy(start.document.parts[0]!.copies![0]!.id.slice(0, 8)).id).toBe(copy.id);
      expect(copy.id).toBe(`${start.document.parts[0]!.id}:${start.document.parts[0]!.copies![0]!.id}`);
      d.removeCopy(copy);
      d.removeVariable('unused');
    });
    expect(result.ok).toBe(true);
    expect(result.document.parts[0]!.copies).toBeUndefined();
    expect(result.document.variables!.map(variable => variable.name)).toEqual(['width']);
  });
  it('refuses removing an in-use variable', async () => {
    const start = await panel();
    const result = await editCad(start.document, d => d.removeVariable('width'));
    expect(result.scriptError).toMatch(/used/);
    expect(result.document).toEqual(start.document);
  });
  it('refuses settings that are not part of the selected step', async () => {
    const start = await panel();
    const result = await editCad(start.document, d => d.step(`${d.part('Panel').id}:extrude`).set({ depth: 4 }));
    expect(result.scriptError).toMatch(/no setting depth.*thickness/);
  });
  it('removes a pattern, a cut-parts step and a part explicitly', async () => {
    const start = await editCad(null, d => {
      const a = d.newPart('A');
      a.profile.rect({ at: [0, 0], w: 100, h: 80 });
      a.place({ at: [0, 0, 0] });
      a.pattern({ axis: 'z', count: 3, spacing: 100 });
      const b = d.newPart('B');
      b.profile.rect({ at: [0, 0], w: 10, h: 10 });
      b.place({ at: [10, 10, 12] });
      d.cutParts(a, { with: b });
    });
    const cut = start.document.partCuts![0]!;
    const result = await editCad(start.document, d => {
      d.removeStep(cut.id);
      d.removePattern('A');
      d.removePart('B');
    });
    expect(result.ok).toBe(true);
    expect(result.document.parts).toHaveLength(1);
    expect(result.document.partCuts).toBeUndefined();
    expect(result.document.parts[0]!.pattern).toBeUndefined();
  });
  it('limits a cut-parts step to one shelf and reports the remaining interference', async () => {
    const start = await editCad(null, d => {
      const side = d.newPart('Side');
      side.profile.rect({ at: [0, 0], w: 100, h: 400 });
      side.drawOn('right');
      const shelf = d.newPart('Shelf');
      shelf.profile.rect({ at: [9, 0], w: 100, h: 100 });
      shelf.drawOn('top', { offset: 80 });
      shelf.pattern({ axis: 'z', count: 4, spacing: 80 });
      d.cutParts(side, { with: shelf });
    });
    const step = start.document.partCuts![0]!;
    const result = await editCad(start.document, d => d.step(step.id).set({ tools: [d.existingCopy('Shelf 2')] }));
    expect(result.scriptError).toBeUndefined();
    expect(result.report.errors.every(error => error.code === 'parts-collide')).toBe(true);
    expect(result.document.partCuts![0]!.tools).toEqual([`${start.document.parts[1]!.id}:${start.document.parts[1]!.copies![0]!.id}`]);
    expect(result.report.parts.find(part => part.name === 'Side')!.cuts).toHaveLength(1);
  });
});

describe('geometric queries after variable edits', () => {
  it('reproduces the trial bench pick after width changes from 900 to 1100', async () => {
    const start = parseCadDocument(
      JSON.parse(await readFile(new URL('../fixtures/designs/task-start-shoe-bench.json', import.meta.url), 'utf8'))
    );
    const result = await editCad(start, d => {
      d.variable('width', '1100mm');
      d.variable('seatCorner', '30mm');
      const seat = d.part('Seat');
      const sketch = seat.sketchOn('top');
      sketch
        .path(['width - board + housing', 0])
        .lineTo(['width - board + housing', 'seatCorner'])
        .lineTo(['width - board', 'seatCorner'])
        .arcTo(['width - board - seatCorner', 0], { r: 'seatCorner', clockwise: true })
        .close();
      // Trial B2 attempts 5–7 could only find the right corner where the old width put it.
      expect(sketch.regionAt(1085, 5).regionId).toContain(':region:');
    });
    expect(result.scriptError).toBeUndefined();
    expect(result.report.parts.find(part => part.name === 'Seat')!.outline!.size[0]).toBe(1080);
  });

  it('picks the new profile extent in the same script without replaying it', async () => {
    const start = await panel();
    let calls = 0;
    const result = await editCad(start.document, d => {
      calls++;
      d.variable('width', '160mm');
      const part = d.part('Panel');
      const newRegion = part.profile.regionAt(150, 40);
      expect(newRegion.regionId).toBe(part.profile.regionAt(50, 40).regionId);
    });
    expect(result.scriptError).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
    expect(result.report.parts[0]!.outline!.size).toEqual([160, 80]);
    expect(result.document.parts[0]!.id).toBe(start.document.parts[0]!.id);
  });
});

describe('compact model reports', () => {
  it('lists a sketch pattern once and retains the evaluated count', async () => {
    const result = await editCad(null, d => {
      const part = d.newPart('Pins');
      part.profile.rect({ at: [0, 0], w: 400, h: 100 });
      const sketch = part.sketchOn('top');
      const hole = sketch.circle({ at: [20, 20], d: 5 });
      sketch.pattern([hole], { count: 10, step: [30, 0] });
      part.cut(sketch.regionAt(20, 20), { depth: 4 });
      part.expect({ pockets: 10 });
    });
    const report = compactCadReport(result.document, result.report);
    expect(result.ok).toBe(true);
    expect(result.report.parts[0]!.cuts).toHaveLength(10);
    expect(report.parts[0]!.cuts).toHaveLength(1);
    expect(report.parts[0]!.cuts[0]).toMatchObject({ count: 10 });
    expect(report.parts[0]!.sketches[1]!.entities.filter(entity => entity.type === 'circle')).toHaveLength(1);
    expect(designSteps(result.document).filter(step => step.kind === 'cut')).toHaveLength(1);
  });
});
