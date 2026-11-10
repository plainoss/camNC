import { describe, expect, it } from 'vitest';
import { readChoiceSketches } from './choiceSketch';
const shape = { kind: 'rect', coords: [10, 10, 80, 80] };
const sketch = { choiceIndex: 0, shapes: [shape] };
describe('bounded assistant choice sketches', () => {
  it('reads each supported primitive and returns independent numeric geometry', () => {
    const source = [
      { choiceIndex: 1, shapes: [shape, { kind: 'ellipse', coords: [50, 50, 25, 20] }, { kind: 'line', coords: [0, 0, 100, 100] }] },
    ];
    const result = readChoiceSketches(source, 2);
    expect(result).toEqual(source);
    expect(result[0].shapes[0]).not.toBe(shape);
    expect(result[0].shapes[0].coords).not.toBe(shape.coords);
  });
  it.each([undefined, null, '<svg/>', {}, Array.from({ length: 5 }, () => sketch)])('ignores malformed optional containers: %j', value => {
    expect(readChoiceSketches(value, 2)).toEqual([]);
  });
  it.each([
    { kind: 'path', coords: [0, 0, 1, 1] },
    { kind: 'rect', coords: [0, 0, 101, 1] },
    { kind: 'rect', coords: [-1, 0, 1, 1] },
    { kind: 'rect', coords: [80, 0, 30, 1] },
    { kind: 'rect', coords: [0, 80, 1, 30] },
    { kind: 'rect', coords: [0, 0, 0, 1] },
    { kind: 'ellipse', coords: [10, 50, 20, 20] },
    { kind: 'ellipse', coords: [50, 90, 20, 20] },
    { kind: 'ellipse', coords: [50, 50, 0, 20] },
    { kind: 'line', coords: [10, 10, 10, 10] },
    { kind: 'line', coords: [0, 0, Infinity, 10] },
    { kind: 'line', coords: [0, 0, NaN, 10] },
    { kind: 'line', coords: ['0', 0, 10, 10] },
    { kind: 'line', coords: [0, 0, 10] },
    { kind: 'line', coords: [0, 0, 10, 10, 20] },
    { kind: 'rect', coords: [0, 0, 10, 10], fill: 'url(https://example.com)' },
    '<svg onload="alert(1)"/>',
    null,
  ])('drops malformed sketches while keeping valid peers: %j', invalidShape => {
    expect(readChoiceSketches([{ choiceIndex: 1, shapes: [invalidShape] }, sketch], 2)).toEqual([sketch]);
  });
  it.each([-1, 2, 0.5, NaN, '0'])('ignores invalid index %j', choiceIndex => {
    expect(readChoiceSketches([{ ...sketch, choiceIndex }], 2)).toEqual([]);
  });
  it('drops every duplicate index without affecting other choices', () => {
    const other = { ...sketch, choiceIndex: 1 };
    expect(readChoiceSketches([sketch, { ...sketch, shapes: [] }, other], 2)).toEqual([other]);
  });
  it('rejects unknown sketch properties and shape count overflow', () => {
    expect(readChoiceSketches([{ ...sketch, svg: '<svg/>' }], 2)).toEqual([]);
    expect(readChoiceSketches([{ ...sketch, shapes: Array.from({ length: 13 }, () => shape) }], 2)).toEqual([]);
    expect(readChoiceSketches([{ ...sketch, shapes: [] }], 2)).toEqual([]);
  });
  it('accepts shapes touching the boundary and the maximum shape count', () => {
    const boundary = {
      choiceIndex: 0,
      shapes: [
        { kind: 'rect', coords: [0, 0, 100, 100] },
        { kind: 'ellipse', coords: [50, 50, 50, 50] },
        ...Array.from({ length: 10 }, () => shape),
      ],
    };
    expect(readChoiceSketches([boundary], 2)).toEqual([boundary]);
  });
});
