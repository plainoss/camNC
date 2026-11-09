import { describe, expect, it } from 'vitest';
import { createCadDocument, createPlateDocument } from './document';
import { resolveDrawnPlacements } from './drawnOn';
import { resolveUpTo } from './upTo';
import type { CadDocument } from './types';

const plate = (name: string) => ({ ...createPlateDocument({ width: 100, height: 50, thickness: 18 }).parts[0]!, name });

describe('extruding up to a face', () => {
  it('makes the part as thick as the distance to that face, and follows it', () => {
    const lid = { ...plate('Lid'), drawnOn: { on: { plane: 'top' as const }, offset: 200 } };
    const post = {
      ...plate('Post'),
      drawnOn: { on: { plane: 'top' as const }, offset: 0 },
      upTo: { partId: lid.id, face: 'underside' as const },
    };
    const placed = (document: CadDocument) => resolveUpTo(resolveDrawnPlacements(document).document);
    expect(placed({ ...createCadDocument(), parts: [lid, post] }).parts[1]!.thickness).toBe(200);
    // The lid raised to 250: the post reaches it.
    const raised = { ...lid, drawnOn: { ...lid.drawnOn, offset: 250 } };
    expect(placed({ ...createCadDocument(), parts: [raised, post] }).parts[1]!.thickness).toBe(250);
  });

  it('reaches a face moved since its part was last placed', () => {
    const lid = { ...plate('Lid'), drawnOn: { on: { plane: 'top' as const }, offset: 200 } };
    const post = {
      ...plate('Post'),
      drawnOn: { on: { plane: 'top' as const }, offset: 0 },
      upTo: { partId: lid.id, face: 'underside' as const },
    };
    const before = resolveDrawnPlacements({ ...createCadDocument(), parts: [lid, post] }).document;
    // The lid's offset changed, but its stored placement is still at 200.
    const raised = { ...before, parts: [{ ...before.parts[0]!, drawnOn: { ...lid.drawnOn, offset: 250 } }, before.parts[1]!] };
    expect(resolveUpTo(raised).parts[1]!.thickness).toBe(250);
  });

  it('places a symmetric extrude half to each side of its plane', () => {
    const part = { ...plate('Mid'), drawnOn: { on: { plane: 'top' as const }, offset: 0 }, symmetric: true as const };
    expect(resolveDrawnPlacements({ ...createCadDocument(), parts: [part] }).document.parts[0]!.placement!.position[2]).toBe(-9);
  });
});
