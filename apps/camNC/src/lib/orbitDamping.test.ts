import { MOUSE } from 'three';
import { expect, it } from 'vitest';
import { kCadMouseButtons } from './orbitDamping';

it('turns the design views with a right drag and pans them with a middle drag, leaving the left button to pick', () => {
  expect(kCadMouseButtons.RIGHT).toBe(MOUSE.ROTATE);
  expect(kCadMouseButtons.MIDDLE).toBe(MOUSE.PAN);
  expect([MOUSE.ROTATE, MOUSE.DOLLY, MOUSE.PAN]).not.toContain(kCadMouseButtons.LEFT);
});
