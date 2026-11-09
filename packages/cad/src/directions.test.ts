import { describe, expect, it } from 'vitest';
import { cadDirectionVector } from './directions';
import { createCadDocument, createPlateDocument } from './document';
import { resolvePartPatterns } from './partPatterns';
import type { CadDocument } from './types';

const plate = (name: string) => ({ ...createPlateDocument({ width: 100, height: 50 }).parts[0]!, name });

describe('picked directions', () => {
  it('point out of a plane, or into it flipped', () => {
    const document: CadDocument = { ...createCadDocument(), parts: [plate('A')] };
    expect(cadDirectionVector(document, { along: { plane: 'front' } })).toEqual([0, -1, 0]);
    expect(cadDirectionVector(document, { along: { plane: 'front' }, flip: true })).toEqual([0, 1, 0]);
  });

  it('lay a pattern and a transformed copy along them, instead of an axis', () => {
    const part = {
      ...plate('Shelf'),
      placement: { position: [0, 0, 0] as [number, number, number], rotation: [0, 0, 0, 1] as [number, number, number, number] },
      pattern: { id: 'p', axis: 'x' as const, count: 3, spacing: 50, direction: { along: { plane: 'top' as const } } },
      copies: [{ id: 'c', along: { along: { plane: 'right' as const }, distance: 30 } }],
    };
    const laid = resolvePartPatterns({ ...createCadDocument(), parts: [part] }).parts[0]!;
    const at = (id: string) => laid.copies!.find(copy => copy.id === id)!.placement!.position;
    expect(at('c')).toEqual([30, 0, 0]);
    expect(at('p:1')).toEqual([0, 0, 50]);
    expect(at('p:2')).toEqual([0, 0, 100]);
  });
});
