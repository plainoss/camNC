import { expect, it } from 'vitest';
import { studioToolbarActive } from './studioToolbarActive';

it('retains dialog precedence ahead of the selected feature command', () => {
  expect(studioToolbarActive({ choosingFace: true, partCutting: true, mirrorDialog: {} }, 'pattern')).toBe('sketch');
  expect(studioToolbarActive({ partCutting: true, mirrorDialog: {} }, 'pattern')).toBe('cutParts');
  expect(studioToolbarActive({ variableDialog: {}, mirrorDialog: {} }, 'pattern')).toBe('variable');
  expect(studioToolbarActive({ mirrorDialog: {}, planeDialog: {} }, 'pattern')).toBe('mirror');
  expect(studioToolbarActive({ planeDialog: {}, transformDialog: {} }, 'pattern')).toBe('plane');
  expect(studioToolbarActive({ transformDialog: {} }, 'pattern')).toBe('transform');
});

it('retains the active feature and the idle state when no dialog takes priority', () => {
  expect(studioToolbarActive({ choosingFace: false }, 'pattern')).toBe('pattern');
  expect(studioToolbarActive({})).toBeNull();
});
