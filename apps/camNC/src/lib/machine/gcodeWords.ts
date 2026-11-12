/** One G-code word: a letter and its number, e.g. `G43.1` is `{ letter: 'G', value: 43.1 }`. */
export interface Word {
  letter: string;
  value: number;
}

const kWord = /\s*([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+))\s*/iy;

/**
 * The words of a line of code (comments already removed), also written without spaces (`G0G91Z5`, `N10M0`), or `null`
 * when the line is not only words: FluidNC rejects such a line, so it neither pauses nor moves.
 */
export function gcodeWords(code: string): Word[] | null {
  const words: Word[] = [];
  // `%` marks the start or end of a program file and has no words (FluidNC: GCode.cpp `case '%'`).
  if (code.trim() === '%') return words;
  kWord.lastIndex = 0;
  while (kWord.lastIndex < code.length) {
    const start = kWord.lastIndex;
    const match = kWord.exec(code);
    if (!match) return code.slice(start).trim() ? null : words;
    words.push({ letter: match[1]!.toUpperCase(), value: Number(match[2]) });
  }
  return words;
}

/** Whether `words` has `letter` with one of `values` (G43.1 is 43.1, so it is not G43). */
export const hasWord = (words: Word[], letter: string, ...values: number[]) =>
  words.some(w => w.letter === letter && values.some(v => Math.abs(w.value - v) < 1e-9));
