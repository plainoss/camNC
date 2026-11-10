import { describe, expect, it } from 'vitest';
import { cuttingKey, defaultCutting, resolveCutting, savedCuttingFor } from './index';

describe('cutting recipes without browser storage', () => {
  const bit = { number: 1, diameter: 6, name: 'flat', feed: 3000 };
  it('resolves each layer and derives dependent feeds from the resolved values', () => {
    const resolved = resolveCutting(bit, 'oak', { feed: 2000 }, { plungeFeed: 300, finalFeedFactor: 0.3 });
    expect(resolved.values).toMatchObject({ feed: 2000, plungeFeed: 300, rampFeed: 300, finishFeed: 600, leadFeed: 2000 });
    expect(resolved.source).toMatchObject({ feed: 'saved', plungeFeed: 'job', stepdown: 'default' });
    expect(defaultCutting(6, 'oak').stepdown).toBe(3);
  });
  it('keeps explicit zero values, and reads saved values by physical tool', () => {
    const physical = { ...bit, guid: 'tool' };
    expect(resolveCutting(bit, 'oak', undefined, { outlineFinish: 0 }).values.outlineFinish).toBe(0);
    expect(savedCuttingFor({ [cuttingKey(physical, 'oak')]: { feed: 1000 }, ['1|6|flat@oak']: { feed: 2000 } }, physical, 'oak')).toEqual({
      feed: 1000,
    });
  });
});
