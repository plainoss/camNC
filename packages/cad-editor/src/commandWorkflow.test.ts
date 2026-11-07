import { addConstraint, addLine, createCadDocument, createCadPart, solveCadDocument } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { buildConstraintForSelection } from './constraintCommands';
import { cadSession, commitCadSession, endCadSession, redoCadSession, undoCadSession } from './session';

// Semantic command -> real solver -> history. Pointer picking and focus stay in browser workflows.
it.each(['horizontal', 'vertical'] as const)('%s command solves and survives Undo/Redo without browser state', async tool => {
  const document = createCadDocument();
  const part = createCadPart();
  part.sketch = addLine(part.sketch, { x1: 20, y1: 20, x2: 90, y2: 60 });
  document.parts.push(part);
  const before = structuredClone(document);
  const session = cadSession(document);
  try {
    const line = part.sketch.entities.find(entity => entity.type === 'line')!;
    const command = buildConstraintForSelection(part.sketch, tool, [line.id]);
    expect(command.needsMore).toBe(false);
    if (!command.constraint) throw new Error(command.message);
    const result = await solveCadDocument({ ...document, parts: [{ ...part, sketch: addConstraint(part.sketch, command.constraint) }] });
    expect(result.sketches[0]?.status).toBe('solved');
    const next = commitCadSession(session, result.document);
    const points = next.parts[0]!.sketch.entities;
    const a = points.find(entity => entity.id === line.startId)!;
    const b = points.find(entity => entity.id === line.endId)!;
    if (a.type !== 'point' || b.type !== 'point') throw new Error('Expected line endpoints');
    expect(tool === 'horizontal' ? a.y - b.y : a.x - b.x).toBeCloseTo(0, 7);
    expect(undoCadSession(session).parts).toEqual(before.parts);
    expect(redoCadSession(session).parts).toEqual(next.parts);
    expect(document).toEqual(before);
  } finally {
    endCadSession(document.id);
  }
});
