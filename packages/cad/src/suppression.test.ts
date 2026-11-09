import { describe, expect, it } from 'vitest';
import { cadPartsToCut } from './copies';
import { createCadDocument, createPlateDocument } from './document';
import { evaluateCadDocument } from './features';
import { activeDesign } from './suppression';
import type { CadDocument } from './types';

const plate = (name: string) => ({ ...createPlateDocument({ width: 100, height: 50 }).parts[0]!, name });

describe('suppressed steps', () => {
  it('build nothing, and keep their settings', () => {
    const a = { ...plate('A'), suppressed: true as const };
    const b = { ...plate('B'), copies: [{ id: 'c1', suppressed: true as const }, { id: 'c2' }] };
    const document: CadDocument = { ...createCadDocument(), parts: [a, b] };
    const built = activeDesign(document);
    expect(built.parts[0]!.extrude).toBe(false);
    expect(built.parts[1]!.copies?.map(copy => copy.id)).toEqual(['c2']);
    // The design itself still has them.
    expect(document.parts[1]!.copies).toHaveLength(2);
    const evaluated = evaluateCadDocument(document);
    expect(cadPartsToCut(document, evaluated.parts).map(entry => entry.names)).toEqual([['B', 'B 3']]);
  });

  it('leaves a design with nothing suppressed as it is', () => {
    const document: CadDocument = { ...createCadDocument(), parts: [plate('A')] };
    expect(activeDesign(document)).toBe(document);
  });
});

describe('suppressed steps, more', () => {
  it('cut nothing with a suppressed part, and keep the copies after a suppressed one named as they were', () => {
    const tool = { ...plate('Tool'), suppressed: true as const };
    const target = { ...plate('Target'), copies: [{ id: 'c1', suppressed: true as const }, { id: 'c2' }] };
    const document: CadDocument = {
      ...createCadDocument(),
      parts: [tool, target],
      partCuts: [{ id: 'cut', tools: [tool.id], targets: [target.id], clearance: 0 }],
    };
    const built = activeDesign(document);
    expect(built.partCuts).toBeUndefined();
    expect(built.parts[1]!.copies?.map(copy => copy.name)).toEqual(['Target 3']);
  });
});
