import { describe, expect, it } from 'vitest';
import { addLine, createCadDocument, createCadPart } from '@wbcnc/cad';
import { editCad } from './edit';
import { cupboard } from './cupboard';

const emptyStudio = () => {
  const document = createCadDocument();
  document.parts.push(createCadPart('Part 1'));
  return document;
};
describe('scripts starting from an empty studio', () => {
  it('inserts a cupboard beside the pristine invisible starter without changing its IDs', async () => {
    const start = emptyStudio(),
      before = structuredClone(start);
    const result = await editCad(start, cupboard());
    expect(result.scriptError).toBeUndefined();
    expect(result.report.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(start).toEqual(before);
    expect(result.document.parts[0]).toEqual({ ...before.parts[0]!, extrude: false });
    expect(result.document.parts).toHaveLength(6);
    expect(result.document.folders).toHaveLength(1);
    expect(result.report.parts.find(part => part.name === 'Side')!.outline?.size).toEqual([300, 720]);
  });
  it('can draw into the starter directly and keeps its implicit extrude', async () => {
    const start = emptyStudio();
    const result = await editCad(start, d => d.part('Part 1').profile.rect({ at: [0, 0], w: 100, h: 80 }));
    expect(result.ok).toBe(true);
    expect(result.document.parts[0]!.id).toBe(start.parts[0]!.id);
    expect(result.document.parts[0]!.extrude).toBeUndefined();
    expect(result.parts[0]!.outline).toHaveLength(4);
  });
  it('does not turn an unfinished user sketch into an unextruded placeholder', async () => {
    const start = emptyStudio();
    start.parts[0]!.sketch = addLine(start.parts[0]!.sketch, { x1: 0, y1: 0, x2: 100, y2: 0 });
    const entities = structuredClone(start.parts[0]!.sketch.entities);
    const result = await editCad(start, d => d.newPart('Panel').profile.rect({ at: [0, 0], w: 100, h: 80 }));
    expect(result.ok).toBe(false);
    expect(result.document.parts[0]!.extrude).toBeUndefined();
    expect(result.document.parts[0]!.sketch.entities).toEqual(entities);
  });
  it('does not normalize renamed or otherwise configured empty parts', async () => {
    const start = emptyStudio();
    start.parts[0]!.name = 'Outline to finish';
    const result = await editCad(start, d => d.newPart('Panel').profile.rect({ at: [0, 0], w: 100, h: 80 }));
    expect(result.ok).toBe(false);
    expect(result.document.parts[0]!.name).toBe('Outline to finish');
    expect(result.document.parts[0]!.extrude).toBeUndefined();
  });
  it('returns the exact original studio document when a script stops', async () => {
    const start = emptyStudio();
    const result = await editCad(start, d => {
      d.newPart('Panel');
      d.part('Missing');
    });
    expect(result.scriptError).toBeDefined();
    expect(result.document).toEqual(start);
  });
});
