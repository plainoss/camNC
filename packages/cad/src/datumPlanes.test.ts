import { describe, expect, it } from 'vitest';
import { cadDatumFrame, nextDatumName, removeDatumPlane, resolveDatumPlanes } from './datumPlanes';
import { createCadDocument, createPlateDocument, parseCadDocument } from './document';
import { resolveDrawnPlacements } from './drawnOn';
import { solveCadDocument } from './solver';
import type { CadDocument } from './types';

const plate = (name: string) => ({ ...createPlateDocument({ width: 100, height: 50 }).parts[0]!, name });

const withPlane = (offset: number, offsetExpression?: string): CadDocument => {
  const part = { ...plate('Shelf'), drawnOn: { on: { plane: 'top' as const }, offset: 0, datum: 'p1' } };
  return {
    ...createCadDocument(),
    parts: [part],
    planes: [{ id: 'p1', name: 'Plane 1', on: { plane: 'top' }, offset, ...(offsetExpression && { offsetExpression }) }],
  };
};

describe('datum planes', () => {
  it('sit offset along the normal of what they’re on', () => {
    const frame = cadDatumFrame(withPlane(120), 'p1')!;
    expect(frame.origin[2]).toBe(120);
    expect(frame.normal).toEqual([0, 0, 1]);
    expect(cadDatumFrame(withPlane(120), 'gone')).toBeNull();
  });

  it('carry what’s drawn on them, and it follows when the plane changes', () => {
    const resolved = resolveDrawnPlacements(resolveDatumPlanes(withPlane(120))).document;
    expect(resolved.parts[0]!.drawnOn).toMatchObject({ offset: 120, datum: 'p1' });
    expect(resolved.parts[0]!.placement!.position[2]).toBe(120);
    const moved = resolveDrawnPlacements(resolveDatumPlanes(withPlane(200))).document;
    expect(moved.parts[0]!.placement!.position[2]).toBe(200);
  });

  it('follow a variable', async () => {
    const document = { ...withPlane(0, 'shelf'), variables: [{ id: 'v', name: 'shelf', expression: '250 mm' }] };
    const solved = (await solveCadDocument(document)).document;
    expect(solved.planes![0]!.offset).toBe(250);
    expect(solved.parts[0]!.drawnOn!.offset).toBe(250);
  });

  it('are saved, and a part can’t name one that isn’t there', () => {
    const document = withPlane(100);
    expect(parseCadDocument(JSON.parse(JSON.stringify(document))).planes).toHaveLength(1);
    expect(() => parseCadDocument({ ...document, planes: undefined })).toThrow();
  });

  it('when deleted, leave what’s drawn on them where it was', () => {
    const removed = removeDatumPlane(resolveDatumPlanes(withPlane(100)), 'p1');
    expect(removed.planes).toBeUndefined();
    expect(removed.parts[0]!.drawnOn).toEqual({ on: { plane: 'top' }, offset: 100 });
    expect(nextDatumName(withPlane(1))).toBe('Plane 2');
  });
});
