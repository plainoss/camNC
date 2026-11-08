import { describe, expect, it } from 'vitest';
import { snapToFace } from './faceSnap';

// The eight corners of a 100 x 50 x 18 board.
const board = [0, 100].flatMap(x => [0, 50].flatMap(y => [0, 18].flatMap(z => [x, y, z])));

describe('snapping a click on a face', () => {
  it('goes to the middle of the face when the click is nearer it than any corner', () => {
    expect(snapToFace(board, [40, 20, 18], [0, 0, 1])).toEqual([50, 25, 18]);
  });

  it('goes to the nearest corner of that face only', () => {
    expect(snapToFace(board, [95, 46, 18], [0, 0, 1])).toEqual([100, 50, 18]);
    expect(snapToFace(board, [100, 3, 2], [1, 0, 0])).toEqual([100, 0, 0]);
  });

  it('keeps the click when nothing lies in its plane', () => {
    expect(snapToFace(board, [10, 10, 9], [0, 0, 1])).toEqual([10, 10, 9]);
  });
});
