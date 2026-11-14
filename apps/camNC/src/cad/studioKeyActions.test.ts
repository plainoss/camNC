import { createPlateDocument, designSteps } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { studioKeyActions } from './studioKeyActions';

it('moves the rollback bar a step with the arrows, and hides then shows every sketch with Shift+H', () => {
  const document = createPlateDocument({ width: 120, height: 80, thickness: 18 });
  const ids = designSteps(document).map(step => step.id);
  let rolled: string | null = null;
  let visibility: Readonly<Record<string, boolean>> = {};
  const keys = studioKeyActions(
    { current: document },
    id => visibility[id] ?? true,
    next => (visibility = typeof next === 'function' ? next(visibility) : next),
    next => (rolled = typeof next === 'function' ? next(rolled) : next)
  );
  keys.moveRollback(-1);
  expect(rolled).toBe(ids.at(-2));
  keys.moveRollback(-1);
  expect(rolled).toBe(ids[0]);
  keys.moveRollback(1);
  keys.moveRollback(1);
  expect(rolled).toBeNull();
  keys.toggleSketches();
  expect(visibility[`${document.parts[0]!.id}:sketch`]).toBe(false);
  keys.toggleSketches();
  expect(visibility[`${document.parts[0]!.id}:sketch`]).toBe(true);
});
