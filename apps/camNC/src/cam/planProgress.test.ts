import { afterEach, describe, expect, it } from 'vitest';
import { followPlan, secondsLeft, timeLeftText, usePlanProgress } from './planProgress';

afterEach(() => usePlanProgress.setState({}, true));

describe('followPlan', () => {
  it('shows how far a board got from its first report until it ends', () => {
    const plan = followPlan('a');
    expect(usePlanProgress.getState().a).toBeUndefined();
    plan.onProgress(0);
    const { startedAt } = usePlanProgress.getState().a!;
    plan.onProgress(0.4);
    expect(usePlanProgress.getState().a).toEqual({ fraction: 0.4, startedAt });
    plan.end();
    expect(usePlanProgress.getState()).toEqual({});
  });

  it('lets a later plan of the board take over, and the earlier one ending leaves it', () => {
    const first = followPlan('a');
    const second = followPlan('a');
    first.onProgress(0.9);
    second.onProgress(0.1);
    first.end();
    expect(usePlanProgress.getState().a?.fraction).toBe(0.1);
    second.end();
    expect(usePlanProgress.getState().a).toBeUndefined();
  });
});

describe('time left', () => {
  it('comes from how long it took to get this far, once there is enough to go by', () => {
    expect(secondsLeft({ fraction: 0.25, startedAt: 0 }, 10_000)).toBeCloseTo(30);
    expect(secondsLeft({ fraction: 0.25, startedAt: 0 }, 500)).toBeUndefined();
    expect(secondsLeft({ fraction: 0.01, startedAt: 0 }, 10_000)).toBeUndefined();
  });

  it('is said in steps that do not flicker', () => {
    expect(timeLeftText(0.8)).toBe('almost done');
    expect(timeLeftText(6.4)).toBe('about 6 s left');
    expect(timeLeftText(33)).toBe('about 35 s left');
    expect(timeLeftText(150)).toBe('about 3 min left');
  });
});
