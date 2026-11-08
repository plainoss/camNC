import { describe, expect, it } from 'vitest';
import { initialLinearPatternParameters, linearPatternParameters, parseLinearPatternParameters } from './linearPatternParameters';

const variables = { height: { value: 720, kind: 'length' as const }, pitch: { value: 32, kind: 'length' as const } };

describe('linear pattern values', () => {
  it('keeps counts and spacings typed with variables, a count rounding down to what fits', () => {
    const parsed = parseLinearPatternParameters(
      { ...initialLinearPatternParameters(), countX: '(height - 64)/pitch + 1', spacingX: 'pitch', angleX: '90' },
      variables
    );
    expect(parsed).toMatchObject({
      ok: true,
      countX: 21,
      countY: 1,
      expressions: { countX: '(height - 64)/pitch + 1', spacingX: 'pitch' },
    });
    if (!parsed.ok) throw new Error(parsed.message);
    expect(parsed.stepX.x).toBe(0);
    expect(parsed.stepX.y).toBeCloseTo(32, 12);
  });

  it('keeps nothing extra for plain numbers or plain arithmetic', () => {
    expect(parseLinearPatternParameters({ ...initialLinearPatternParameters(), spacingX: '20 + 20' }, variables)).not.toHaveProperty(
      'expressions'
    );
  });

  it('shows a pattern’s typed values when editing it again', () => {
    const shown = linearPatternParameters({
      type: 'linearPattern',
      id: 'p',
      seedKeys: [],
      masterX: 0,
      masterY: 0,
      countX: 21,
      countY: 1,
      stepX: { x: 0, y: 32 },
      stepY: { x: 0, y: 40 },
      instances: [],
      exclusions: [],
      expressions: { countX: '(height - 64)/pitch + 1', spacingX: 'pitch' },
    });
    expect(shown).toMatchObject({ countX: '(height - 64)/pitch + 1', spacingX: 'pitch', angleX: '90' });
  });
});
