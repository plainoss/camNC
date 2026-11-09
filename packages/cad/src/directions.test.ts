import { describe, expect, it } from 'vitest';
import { cadDirectionVector } from './directions';
import { createCadDocument, createPlateDocument } from './document';
import { resolvePartPatterns } from './partPatterns';
import { resolveDrawnPlacements } from './drawnOn';
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

describe('a part moved without copying', () => {
  it('sits moved from where it’s drawn, and what’s drawn on it moves along', () => {
    const base = {
      ...plate('Base'),
      drawnOn: { on: { plane: 'top' as const }, offset: 0 },
      moved: { by: [0, 0, 30] as [number, number, number] },
    };
    const lid = { ...plate('Lid'), drawnOn: { on: { partId: base.id, face: 'top' as const }, offset: 0 } };
    const resolved = resolveDrawnPlacements({ ...createCadDocument(), parts: [base, lid] }).document;
    expect(resolved.parts[0]!.placement!.position).toEqual([0, 0, 30]);
    // The lid sits on the base's top, 30 mm up plus the base's 18 mm.
    expect(resolved.parts[1]!.placement!.position[2]).toBe(48);
  });

  it('moves a distance along a picked direction', () => {
    const base = {
      ...plate('Base'),
      drawnOn: { on: { plane: 'top' as const }, offset: 0 },
      moved: { along: { plane: 'front' as const }, distance: 25 },
    };
    const resolved = resolveDrawnPlacements({ ...createCadDocument(), parts: [base] }).document;
    expect(resolved.parts[0]!.placement!.position).toEqual([0, -25, 0]);
  });
});

describe('a move typed with variables', () => {
  it('follows them', async () => {
    const { applyCadVariables } = await import('./variables');
    const base = {
      ...plate('Base'),
      drawnOn: { on: { plane: 'top' as const }, offset: 0 },
      moved: {
        by: [0, 0, 30] as [number, number, number],
        byExpressions: [null, null, 'lift'] as [string | null, string | null, string | null],
      },
    };
    const document: CadDocument = { ...createCadDocument(), variables: [{ id: 'v', name: 'lift', expression: '45 mm' }], parts: [base] };
    expect(applyCadVariables(document).parts[0]!.moved).toMatchObject({ by: [0, 0, 45] });
  });
});
