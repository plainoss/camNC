import { describe, expect, it } from 'vitest';
import {
  kMaxStartPauseGapLines,
  kStartPauseGapLine,
  parsePauseMarker,
  pauseMarker,
  type PauseMarker,
  positionWindow,
  startPauseGap,
} from './pauseMarker';

const comment = (m: PauseMarker) => pauseMarker(m).slice(1, -1);

describe('pause markers', () => {
  it('read back what was written, for every kind', () => {
    const markers: PauseMarker[] = [
      { kind: 'start', rpm: 18000 },
      { kind: 'take-out', n: 2, of: 5, part: 'Part 1b', next: 'Part 2' },
      { kind: 'take-out', n: 5, of: 5, part: 'Part 4' },
      { kind: 'tab', n: 3, of: 8, part: 'Seite links' },
      { kind: 'done' },
    ];
    for (const m of markers) expect(parsePauseMarker(comment(m))).toEqual(m);
    expect(pauseMarker(markers[1]!)).toBe('(CAMNC PAUSE take-out; n=2/5; part=Part 1b; next=Part 2)');
  });

  it('keeps names inside the comment and the line short', () => {
    const line = pauseMarker({ kind: 'take-out', n: 12, of: 12, part: 'a (left); b'.repeat(10), next: 'x'.repeat(100) });
    expect(line.slice(1, -1)).not.toMatch(/[()]/);
    expect(line.length).toBeLessThanOrEqual(127);
    expect(parsePauseMarker(line.slice(1, -1))).toMatchObject({ kind: 'take-out', n: 12, of: 12 });
    // Within the limit in UTF-8 bytes, not characters.
    const umlauts = pauseMarker({ kind: 'take-out', n: 2, of: 5, part: 'Länge'.repeat(8), next: 'Länge'.repeat(8) });
    expect(new TextEncoder().encode(umlauts).length).toBeLessThanOrEqual(127);
    expect(parsePauseMarker(umlauts.slice(1, -1))).toMatchObject({ kind: 'take-out', part: expect.stringMatching(/^Länge/) });
  });

  it('is null for other comments and broken markers', () => {
    expect(parsePauseMarker('MSG Take out Part 1b')).toBeNull();
    expect(parsePauseMarker('CAMNC PAUSE take-out; part=a')).toBeNull();
    expect(parsePauseMarker('CAMNC PAUSE something')).toBeNull();
  });
});

describe('the gap after the start pause', () => {
  const m3 = 'M3 S18000\n'.length;

  it('makes the M3 end more than two position windows after the start M0, at any size up to the cap', () => {
    for (let size = 1000; size < 41_000_000; size = Math.ceil(size * 1.07)) {
      const gap = startPauseGap(size, m3);
      const final = size + gap.length * 80;
      if (gap.length < kMaxStartPauseGapLines) expect(gap.length * 80 + m3).toBeGreaterThan(2 * positionWindow(final));
    }
    // About 40 MB is the largest the capped gap covers.
    const atCap = 40_000_000;
    expect(startPauseGap(atCap, m3).length).toBeLessThanOrEqual(kMaxStartPauseGapLines);
    expect(kMaxStartPauseGapLines * 80 + m3).toBeGreaterThan(2 * positionWindow(atCap + kMaxStartPauseGapLines * 80));
    expect(startPauseGap(100_000_000, m3)).toHaveLength(kMaxStartPauseGapLines);
  });

  it('is nothing for programs under about 60 kB, and plain `;` comment lines of 80 bytes', () => {
    expect(startPauseGap(50_000, m3)).toEqual([]);
    const gap = startPauseGap(1_000_000, m3);
    expect(gap.length).toBeGreaterThan(0);
    expect(new Set(gap)).toEqual(new Set([kStartPauseGapLine]));
    expect(new TextEncoder().encode(kStartPauseGapLine + '\n').length).toBe(80);
    expect(kStartPauseGapLine.startsWith(';')).toBe(true);
  });
});
