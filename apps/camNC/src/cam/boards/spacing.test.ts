import { describe, expect, it } from 'vitest';
import { boardGap, defaultMargin, freezeSpacing, tabRoomFix } from './spacing';

describe('tabRoomFix', () => {
  it('names the gap and margin that fit tabs when a bigger bit leaves the old spacing too tight', () => {
    // The 3.175 mm bit's tab spacing, kept when the job switches to the 6 mm bit.
    const [frozen] = freezeSpacing([{ retention: 'tabs' } as Parameters<typeof freezeSpacing>[0][number]], 3.175);
    expect([frozen!.gap, frozen!.margin]).toEqual([10, 6.7]);
    expect([boardGap(6, 'tabs'), defaultMargin(6, 'tabs')]).toEqual([16, 9.5]);
    expect(tabRoomFix({ gap: frozen!.gap!, margin: frozen!.margin! }, 6, 5)).toBe(
      'The spacing is too tight for tabs with the ⌀6 bit: widen the gap between parts to 16 mm and the margin to 9.5 mm, use a smaller bit'
    );
    expect(tabRoomFix({ gap: 16, margin: 6.7 }, 6, 1)).toBe(
      'The spacing is too tight for tabs with the ⌀6 bit: widen the margin to 9.5 mm, use a smaller bit'
    );
  });

  it('still names the gap and margin when the spacing already fits tabs', () => {
    expect(tabRoomFix({ gap: 16, margin: 12 }, 6, 1)).toBe('Give it more room (a wider gap or margin, or move it), use a smaller bit');
    expect(tabRoomFix({ gap: 10, margin: 6.7 }, 3.175, 2)).toBe(
      'Give them more room (a wider gap or margin, or move them), use a smaller bit'
    );
  });
});
