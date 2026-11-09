import { createCadPart } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { drawnSelection, withSizeExpressions } from './drawingCommit';
import { createRectangle, rectanglePrompt } from './rectangleTool';

const empty = () => createCadPart().sketch;
/** Each edge has its own end points, joined by relations; the corners are where they are. */
const corners = (sketch: ReturnType<typeof empty>) =>
  [...new Set(sketch.entities.flatMap(e => (e.type === 'point' && !e.construction ? [`${e.x},${e.y}`] : [])))].sort();
const lines = (sketch: ReturnType<typeof empty>) => sketch.entities.filter(e => e.type === 'line' && !e.construction);

describe('rectangle tool', () => {
  it('draws a corner rectangle from either diagonal without dimensions', () => {
    const before = empty();
    const result = createRectangle(before, { tool: 'rectangle', start: { x: 80, y: 60 }, end: { x: 20, y: 20 } });
    expect(result.error).toBeUndefined();
    expect(corners(result.sketch!)).toEqual(['20,20', '20,60', '80,20', '80,60']);
    expect(lines(result.sketch!)).toHaveLength(4);
    expect(result.sketch!.constraints.filter(c => 'value' in c)).toEqual([]);
  });

  it('draws a center rectangle about its first click', () => {
    const result = createRectangle(empty(), { tool: 'centerRectangle', start: { x: 50, y: 50 }, end: { x: 70, y: 60 } });
    expect(corners(result.sketch!)).toEqual(['30,40', '30,60', '70,40', '70,60']);
    // The diagonals that hold the center stay out of the selection.
    const selection = drawnSelection(empty(), result.sketch!, 'centerRectangle');
    expect(selection).toHaveLength(4);
    expect(selection.every(id => lines(result.sketch!).some(line => line.id === id))).toBe(true);
  });

  it('makes typed sizes dimensions, and keeps the expressions typed', () => {
    const before = empty();
    const result = createRectangle(before, {
      tool: 'rectangle',
      start: { x: 0, y: 0 },
      width: 'w*2',
      height: '30',
      variables: { w: { value: 25, kind: 'length' } },
    });
    const sketch = withSizeExpressions(before, result.sketch!, result.sizeExpressions!);
    expect(sketch.constraints.filter(c => 'value' in c)).toMatchObject([
      { label: 'Width', value: 50, expression: 'w*2' },
      { label: 'Height', value: 30 },
    ]);
  });

  it('refuses an empty or flat rectangle with a reason', () => {
    expect(createRectangle(empty(), { tool: 'rectangle', start: { x: 40, y: 40 }, end: { x: 40, y: 40 } })).toEqual({
      error: 'Width and height must be greater than zero.',
    });
    expect(createRectangle(empty(), { tool: 'rectangle', start: { x: 0, y: 0 }, width: '0', height: '10' }).error).toBe(
      'Rectangle width and height must be greater than zero.'
    );
    expect(createRectangle(empty(), { tool: 'rectangle', start: { x: 0, y: 0 }, width: '', height: '10' }).error).toMatch(
      /^Rectangle width: /
    );
  });

  it('names the first click in its prompt', () => {
    expect(rectanglePrompt('rectangle')).toMatch(/first corner/);
    expect(rectanglePrompt('centerRectangle')).toMatch(/center/);
  });
});
