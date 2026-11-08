import { describe, expect, it } from 'vitest';
import { differenceExpression } from './linearExpression';

describe('differenceExpression', () => {
  it('writes a length between two positions as a person would', () => {
    expect(differenceExpression('-legW/2', 'legW/2')).toBe('legW');
    expect(differenceExpression('legH', 'legH + board')).toBe('board');
    expect(differenceExpression('-legW/2', '-tenonW/2')).toBe('legW/2 - tenonW/2');
    expect(differenceExpression(0, 'width - 2*board')).toBe('width - 2*board');
    expect(differenceExpression('board', 'board + 10mm')).toBe(10);
    expect(differenceExpression(20, 'width')).toBe('width - 20mm');
    expect(differenceExpression(3, 7.5)).toBe(4.5);
  });

  it('keeps what it cannot read as a sum', () => {
    expect(differenceExpression('board', 'floor(width/40)*40')).toBe('floor(width/40)*40 - board');
    expect(differenceExpression('a*b', 'c')).toBe('c - (a*b)');
  });
});
