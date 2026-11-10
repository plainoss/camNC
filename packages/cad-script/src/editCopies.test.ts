import { describe, expect, it } from 'vitest';
import { cadPartsToCut, parseCadDocument } from '@wbcnc/cad';
import { editCad } from './edit';

const shelves = () =>
  editCad(null, d => {
    d.variable('width', '100mm');
    d.variable('shelves', '3');
    const shelf = d.newPart('Shelf');
    shelf.profile.rect({ at: [0, 0], w: 'width', h: 80 });
    shelf.place({ at: [0, 0, 0] });
    shelf.pattern({ axis: 'z', count: 'shelves', spacing: 100 });
  });

describe('scripts targeting one copy', () => {
  it('cuts just the named shelf, retains its identity on resize/count changes, and nests siblings together', async () => {
    const start = await shelves();
    const copyId = start.document.parts[0]!.copies![0]!.id;
    const cut = await editCad(start.document, d => {
      const copy = d.existingCopy('Shelf 2');
      const sketch = copy.sketchOn('top');
      sketch.circle({ at: ['width/2', 40], d: 10 });
      copy.cut(sketch.regionAt(d.value('width/2'), 40), { depth: 'through' });
    });
    expect(cut.ok).toBe(true);
    expect(cut.parts[0]!.cuts ?? []).toEqual([]);
    expect(cut.parts[0]!.copyCuts![copyId]).toHaveLength(1);
    expect(cadPartsToCut(cut.document, cut.parts).map(entry => entry.names)).toEqual([['Shelf', 'Shelf 3'], ['Shelf 2']]);
    let current = cut;
    for (const count of ['2', '3'])
      current = await editCad(current.document, d => {
        d.variable('width', '120mm');
        d.variable('shelves', count);
      });
    expect(current.ok).toBe(true);
    expect(current.document.parts[0]!.copies![0]!.id).toBe(copyId);
    expect(current.parts[0]!.copyCuts![copyId]).toHaveLength(1);
    const points = current.parts[0]!.copyCuts![copyId]![0]!.outline;
    expect((Math.min(...points.map(point => point.x)) + Math.max(...points.map(point => point.x))) / 2).toBeCloseTo(60);
    expect(parseCadDocument(JSON.parse(JSON.stringify(current.document)))).toEqual(current.document);
  });
  it('keeps a dropped copy feature dormant, restores it, and can edit its numeric depth', async () => {
    const start = await shelves();
    const copyId = start.document.parts[0]!.copies![1]!.id;
    const made = await editCad(start.document, d => {
      const copy = d.existingCopy('Shelf 3');
      const sketch = copy.sketchOn('top');
      sketch.circle({ at: [50, 40], d: 10 });
      copy.cut(sketch.regionAt(50, 40), { depth: 3 });
    });
    const cut = made.document.parts[0]!.features!.find(feature => feature.type === 'cut')!;
    const down = await editCad(made.document, d => d.variable('shelves', '2'));
    expect(down.ok).toBe(true);
    expect(down.document.parts[0]!.features!.find(feature => feature.id === cut.id)).toMatchObject({ copyId });
    expect(down.report.warnings.some(warning => warning.code === 'copy-feature-inactive')).toBe(true);
    const back = await editCad(down.document, d => {
      d.variable('shelves', '3');
      d.part('Shelf').existingCut(cut.id).depth(6);
    });
    expect(back.ok).toBe(true);
    expect(back.parts[0]!.copyCuts![copyId]![0]!.to).toBe(6);
  });
  it('detaches a copy with its own features and permanently excludes its pattern position', async () => {
    const start = await shelves();
    const copyId = start.document.parts[0]!.copies![0]!.id;
    const made = await editCad(start.document, d => {
      const copy = d.existingCopy('Shelf 2');
      const sketch = copy.sketchOn('top');
      sketch.circle({ at: [50, 40], d: 10 });
      copy.cut(sketch.regionAt(50, 40), { depth: 'through' });
    });
    const detached = await editCad(made.document, d => {
      const own = d.detachCopy('Shelf 2', 'Cable shelf');
      own.profile.circle({ at: [20, 20], d: 5 });
    });
    expect(detached.ok).toBe(true);
    const own = detached.document.parts.find(part => part.name === 'Cable shelf')!;
    expect(own.id).not.toBe(start.document.parts[0]!.id);
    expect(own.placement!.position).toEqual([0, 0, 100]);
    expect(detached.parts.find(part => part.partId === own.id)!.holes).toHaveLength(1);
    expect(detached.parts.find(part => part.partId === own.id)!.cuts).toHaveLength(1);
    let current = detached;
    for (const count of ['2', '3']) current = await editCad(current.document, d => d.variable('shelves', count));
    expect(current.document.parts[0]!.copies!.some(copy => copy.id === copyId)).toBe(false);
    expect(current.document.parts.find(part => part.id === own.id)!.placement).toEqual(own.placement);
    expect(current.document.parts[0]!.pattern!.excluded).toContain(1);
  });
});
