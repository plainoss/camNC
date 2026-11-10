import { expect, it } from 'vitest';
import { jointExpected, trayExpected, type JointIntent } from './woodworkingExpected';
const joint: JointIntent = {
  board: 18,
  legWidth: 300,
  legHeight: 400,
  frameLength: 300,
  frameHeight: 100,
  sideDepth: 200,
  station: 500,
  fingers: 5,
  fit: 0,
  target: 'Side',
  suppressed: false,
};
it('fixes initial tray engagement and volume from independent hand dimensions', () => {
  const expected = trayExpected({
    width: 360,
    depth: 240,
    height: 80,
    board: 12,
    rebate: 4,
    dividers: 3,
    shift: 0,
    fit: 0,
    tools: 'family',
    suppressed: false,
  });
  expect(expected.bodies.find(b => b.name === 'Base')!.volume).toBe(1005696);
  expect(expected.bodies.find(b => b.name === 'Divider')!.bounds).toEqual({ min: [90, 12, 8], max: [102, 228, 80] });
});
it('keeps the historical positive-world-end target phase for odd and even counts, then exchanges owners', () => {
  for (const count of [5, 8]) {
    const expected = jointExpected({ ...joint, fingers: count });
    const top = expected.bands[0]!;
    expect(top.target).toBe('Side');
    expect(top.z).toEqual([100 - 100 / count, 100]);
    expect(expected.materialProbes.find(p => p.body === 'Side' && p.point[2] === 100 - 50 / count)!.material).toBe(false);
  }
  const swapped = jointExpected({ ...joint, fingers: 8, target: 'Front' });
  expect(swapped.materialProbes.find(p => p.body === 'Front' && p.point[2] === 93.75)!.material).toBe(false);
  expect(swapped.materialProbes.find(p => p.body === 'Side' && p.point[2] === 93.75)!.material).toBe(true);
});
