import { describe, expect, it } from 'vitest';
import { createPlateDocument, parseCadDocument } from './document';
import { fuzzFixtureDocuments } from './fuzzFixtures';

/** Inputs the parser fuzz found crashing parseCadDocument with a TypeError or RangeError instead of refusing them. */
function refusal(input: unknown): Error {
  try {
    parseCadDocument(input);
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).constructor, (error as Error).message).toBe(Error);
    return error as Error;
  }
  throw new Error('Expected the document to be refused');
}

const studioSteps = () => JSON.parse(fuzzFixtureDocuments().find(fixture => fixture.name === 'studio-steps')!.text);

describe('parseCadDocument refuses what it used to crash on', () => {
  // parseFuzz seed 160: `'face' in 0.5`.
  it('a support or direction that is not an object', () => {
    const drawn = createPlateDocument();
    drawn.parts[0]!.drawnOn = { on: 0.5, offset: 0 } as never;
    expect(refusal(drawn).message).toBe('Invalid CAD part support');
    const copied = createPlateDocument();
    copied.parts[0]!.copies = [{ id: 'copy', along: 0.5 } as never];
    expect(refusal(copied).message).toBe('Invalid CAD direction');
  });

  // parseFuzz seeds 13, 107, 114 and 178: `'value' in -1e308` while migrating a removed face sketch nobody checked.
  it.each([-1e308, 0.5, null, 'x'])('a constraint of %s in the sketch a Remove step owns', value => {
    const document = studioSteps();
    const removed = document.parts.flatMap((part: { features?: { removedBy?: string; sketch: { constraints: unknown[] } }[] }) =>
      (part.features ?? []).filter(feature => feature.removedBy)
    );
    expect(removed.length).toBeGreaterThan(0);
    removed[0].sketch.constraints.push(value);
    expect(refusal(document).message).toBe('Invalid CAD constraint');
  });

  // parseFuzz seed 83: an entity of null in a removed face sketch reached withSplineHandleSegments.
  it('an entity of null in a copied sketch', () => {
    const document = studioSteps();
    const removed = document.parts.flatMap((part: { features?: { removedBy?: string; sketch: { entities: unknown[] } }[] }) =>
      (part.features ?? []).filter(feature => feature.removedBy)
    );
    removed[0].sketch.entities[0] = null;
    expect(refusal(document).message).toBe('Invalid CAD entity');
    // A New extrude's part shares its owner's sketch: a copy whose IDs are the owner's, checked against its own.
    const shared = createPlateDocument();
    const owner = shared.parts[0]!;
    shared.parts.push({ ...structuredClone(owner), id: 'extrude-2', sketchOf: owner.id, regions: [] });
    expect(() => parseCadDocument(structuredClone(shared))).not.toThrow();
    (shared.parts[1]!.sketch.entities as unknown[]).push(null);
    expect(refusal(shared).message).toBe('Invalid CAD entity');
  });

  // The oversized-input fuzz: 5 000 levels of nesting overflowed structuredClone with a RangeError.
  it('a document nested thousands of levels deep', () => {
    let deep: unknown = 1;
    for (let i = 0; i < 5000; i++) deep = { deep };
    expect(refusal({ ...createPlateDocument(), extra: deep }).message).toBe('Invalid CAD document');
  });

  it('still loads the saved designs, copies included', () => {
    for (const fixture of fuzzFixtureDocuments()) expect(() => parseCadDocument(JSON.parse(fixture.text)), fixture.name).not.toThrow();
  });
});
