import { describe, expect, it } from 'vitest';
import { createPlateDocument, designSteps, partCutInputProblems, type CadDocument, type CadPart } from './index';

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
});
