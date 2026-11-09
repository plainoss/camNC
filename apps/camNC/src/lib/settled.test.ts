import { describe, expect, it } from 'vitest';
import { noteDocumentChange, settledSnapshot, trackCalls, trackPending } from './settled';

const frames = (count: number) =>
  new Promise<void>(resolve => {
    const next = (left: number) => (left ? requestAnimationFrame(() => next(left - 1)) : resolve());
    next(count);
  });
const settled = async () => {
  for (let i = 0; i < 20 && Object.values(settledSnapshot().pending).some(Boolean); i++) await frames(1);
  return settledSnapshot();
};

describe('settled signal', () => {
  it('is on window in test builds', () => {
    expect(window.__camncSettled?.()).toEqual(settledSnapshot());
  });

  it('counts work as pending until it ends, either way, and then until a frame is drawn', async () => {
    await settled();
    let finish!: () => void;
    const solve = trackPending('solve', new Promise<void>(resolve => (finish = resolve)));
    const save = trackPending('save', Promise.reject(new Error('disk full')));
    expect(settledSnapshot().pending).toMatchObject({ solve: 1, save: 1, frame: 1 });
    await expect(save).rejects.toThrow('disk full');
    expect(settledSnapshot().pending.save).toBe(0);
    finish();
    await solve;
    expect(settledSnapshot().pending).toMatchObject({ solve: 0, frame: 1 });
    await frames(3);
    expect(settledSnapshot().pending.frame).toBe(0);
  });

  it('counts each call through a tracked remote', async () => {
    await settled();
    let finish!: (value: number) => void;
    const remote = trackCalls('worker', { plan: (n: number) => new Promise<number>(resolve => (finish = v => resolve(v + n))) });
    const plan = remote.plan(1);
    expect(settledSnapshot().pending.worker).toBe(1);
    finish(41);
    expect(await plan).toBe(42);
    expect(settledSnapshot().pending.worker).toBe(0);
  });

  it('counts document changes and input as changes still to be drawn', async () => {
    const before = await settled();
    noteDocumentChange();
    expect(settledSnapshot()).toMatchObject({ revision: before.revision + 1, pending: { frame: 1 } });
    await settled();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(settledSnapshot().pending.frame).toBe(1);
    expect((await settled()).pending.frame).toBe(0);
  });
});
