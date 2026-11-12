import { describe, expect, it } from 'vitest';
import { gcodeWords, hasWord } from './gcodeWords';

describe('gcodeWords', () => {
  it('splits words with and without spaces', () => {
    expect(gcodeWords('G0G91Z5')).toEqual([
      { letter: 'G', value: 0 },
      { letter: 'G', value: 91 },
      { letter: 'Z', value: 5 },
    ]);
    expect(gcodeWords('N10M0')).toEqual([
      { letter: 'N', value: 10 },
      { letter: 'M', value: 0 },
    ]);
    expect(gcodeWords('g43.1 z-.5')).toEqual([
      { letter: 'G', value: 43.1 },
      { letter: 'Z', value: -0.5 },
    ]);
    expect(gcodeWords('Z+5')).toEqual([{ letter: 'Z', value: 5 }]);
    expect(gcodeWords('')).toEqual([]);
    expect(gcodeWords('%')).toEqual([]);
  });

  it('is null for a line that is not only words, which FluidNC rejects', () => {
    for (const code of ['XM0', 'G0 X', 'M0 junk', '$H']) expect(gcodeWords(code)).toBeNull();
  });

  it('tells G43.1 from G43 and M0 from M0.5', () => {
    const words = gcodeWords('G43.1 Z5 M0.5')!;
    expect(hasWord(words, 'G', 43)).toBe(false);
    expect(hasWord(words, 'G', 43.1)).toBe(true);
    expect(hasWord(words, 'M', 0)).toBe(false);
  });
});
