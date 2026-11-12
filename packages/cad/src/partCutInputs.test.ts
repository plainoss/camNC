import { describe, expect, it } from 'vitest';
import {
  addPartCopy,
  createPlateDocument,
  designSteps,
  partCutInputProblems,
  setPartPattern,
  type CadDocument,
  type CadPart,
} from './index';

/** Side cut with Front by one Cut parts step. */
function joined(front: Partial<CadPart> = {}): CadDocument {
  const plate = (name: string) => ({ ...createPlateDocument({ width: 100, height: 100, thickness: 18 }).parts[0]!, name });
  const side = plate('Side'),
    tool = { ...plate('Front'), ...front };
  return {
    ...createPlateDocument({ width: 100, height: 100, thickness: 18 }),
    parts: [side, tool],
    partCuts: [{ id: 'joint', tools: [tool.id], targets: [side.id], clearance: 0 }],
  };
}

const row = (document: CadDocument) => designSteps(document).find(step => step.kind === 'partCut')?.broken;

describe('A Cut parts step whose tool or target isn’t built', () => {
  it('names the tool on its feature row and on the parts it joins once the tool’s Extrude is deleted', () => {
    const document = joined({ extrude: false });
    const [side, front] = document.parts.map(part => part.id);
    const message = 'Cut Side with Front can’t use its tool Front, which isn’t extruded.';
    expect(row(document)).toBe(message);
    expect(partCutInputProblems(document)).toEqual([
      { code: 'part-cut-input', severity: 'error', partId: front, message },
      { code: 'part-cut-input', severity: 'error', partId: side, message },
    ]);
  });

  it('says so for a suppressed or deleted part too, but not while the step itself is off', () => {
    expect(row(joined({ suppressed: true }))).toBe('Cut Side with Front can’t use its tool Front, which is suppressed.');
    const document = joined();
    const front = document.parts[1]!.id;
    expect(row({ ...document, folders: [{ id: 'f', name: 'Off', partIds: [front], suppressed: true }] })).toBe(
      'Cut Side with Front can’t use its tool Front, which is suppressed.'
    );
    const gone = { ...document, parts: document.parts.slice(0, 1) };
    expect(row(gone)).toBe('Cut Side with a removed part can’t use a deleted tool.');
    expect(partCutInputProblems(gone).map(problem => problem.partId)).toEqual([document.parts[0]!.id]);
    const unextruded = joined({ extrude: false });
    expect(row({ ...unextruded, partCuts: [{ ...unextruded.partCuts![0]!, suppressed: true }] })).toBeUndefined();
  });

  it('is quiet while every tool and target is built', () => {
    expect(partCutInputProblems(joined())).toEqual([]);
    expect(row(joined())).toBeUndefined();
  });

  describe('when the tool is one copy of a part', () => {
    /** Front patterned three times along X, its third instance the step's tool. */
    const patterned = () => {
      const document = joined();
      return retargeted(setPartPattern(document, document.parts[1]!.id, { axis: 'x', spacing: 150, count: 3 }), 1);
    };
    /** The design with the step's tool switched to the last copy of the part at `index`. */
    const retargeted = (document: CadDocument, index: number): CadDocument => {
      const part = document.parts[index]!;
      return { ...document, partCuts: [{ ...document.partCuts![0]!, tools: [`${part.id}:${part.copies!.at(-1)!.id}`] }] };
    };

    it('is quiet while that copy is built', () => {
      expect(row(patterned())).toBeUndefined();
    });

    it('says the copy is deleted once the pattern count drops below it', () => {
      const document = patterned();
      const fewer = setPartPattern(document, document.parts[1]!.id, { axis: 'x', spacing: 150, count: 2 });
      expect(fewer.parts[1]!.copies).toHaveLength(1);
      expect(row(fewer)).toBe('Cut Side with a removed part can’t use its tool, a deleted copy of Front.');
    });

    it('says a copy of a suppressed pattern is suppressed', () => {
      const document = patterned();
      const front = document.parts[1]!;
      const off = { ...document, parts: [document.parts[0]!, { ...front, pattern: { ...front.pattern!, suppressed: true as const } }] };
      expect(row(off)).toMatch(/can’t use its tool Front[^,]*, which is suppressed\.$/);
    });

    it('says a suppressed copy is suppressed', () => {
      const plain = joined();
      const document = retargeted(addPartCopy(plain, plain.parts[1]!.id).document, 1);
      expect(row(document)).toBeUndefined();
      const front = document.parts[1]!;
      const off = { ...front, copies: front.copies!.map(copy => ({ ...copy, suppressed: true as const })) };
      expect(row({ ...document, parts: [document.parts[0]!, off] })).toMatch(/can’t use its tool Front[^,]*, which is suppressed\.$/);
    });
  });

  it('says a part drawn on a plane in a suppressed folder is suppressed', () => {
    const document = joined();
    const [side, front] = document.parts;
    const drawn: CadPart = { ...front!, drawnOn: { on: { plane: 'top' }, offset: 0, datum: 'plane' } };
    const folder = { id: 'f', name: 'Planes', partIds: [], planeIds: ['plane'], suppressed: true as const };
    expect(row({ ...document, parts: [side!, drawn], folders: [folder] })).toBe(
      'Cut Side with Front can’t use its tool Front, which is suppressed.'
    );
  });
});
