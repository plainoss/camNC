import { describe, expect, it } from 'vitest';
import { answerQuestionFields, readQuestionFields } from './questionFields';

describe('typed question answers', () => {
  it('keeps only well-formed fields from provider output', () => {
    expect(
      readQuestionFields([
        { name: 'width', label: 'Width', unit: 'mm', value: 280 },
        { name: 'width', label: 'Duplicate', unit: 'mm' },
        { name: 'bad name', label: 'Bad', unit: 'mm' },
        { name: 'depth', label: '', unit: 'mm' },
        { name: 'shelves', label: 'Shelves', unit: 'count', value: -1 },
        'nonsense',
      ])
    ).toEqual([
      { name: 'width', label: 'Width', unit: 'mm', value: 280 },
      { name: 'shelves', label: 'Shelves', unit: 'count' },
    ]);
  });

  it('answers in words and confirms only requirement-named values', () => {
    const fields = readQuestionFields([
      { name: 'width', label: 'Width', unit: 'mm' },
      { name: 'minimumWall', label: 'Wall', unit: 'mm' },
      { name: 'handles', label: 'Handles', unit: 'count' },
    ]);
    expect(answerQuestionFields(fields, { width: 280, minimumWall: 18, handles: 2 })).toEqual({
      text: 'Width: 280 mm, Wall: 18 mm, Handles: 2',
      requirements: { width: 280, minimumWall: 18 },
    });
  });

  it('keeps each valid requirement when another answer cannot be enforced', () => {
    const fields = readQuestionFields([
      { name: 'width', label: 'Width', unit: 'mm' },
      { name: 'holeCount', label: 'Holes', unit: 'mm' },
      { name: 'pocketCount', label: 'Pockets', unit: 'count' },
    ]);
    expect(answerQuestionFields(fields, { width: 300, holeCount: 4.5, pocketCount: 2 })).toEqual({
      text: 'Width: 300 mm, Holes: 4.5 mm, Pockets: 2',
      requirements: { width: 300, pocketCount: 2 },
    });
  });
});
