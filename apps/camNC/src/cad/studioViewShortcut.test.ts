import { expect, it } from 'vitest';
import { studioViewShortcut } from './studioViewShortcut';

it('keeps shifted named views and the unshifted fit shortcut separate', () => {
  expect(studioViewShortcut({ shiftKey: true, code: 'Digit5', key: '%' })).toBe('top');
  expect(studioViewShortcut({ shiftKey: false, code: 'KeyF', key: 'f' })).toBe('fit');
  expect(studioViewShortcut({ shiftKey: true, code: 'KeyF', key: 'F' })).toBeUndefined();
  expect(studioViewShortcut({ shiftKey: false, code: 'Digit5', key: '5' })).toBeUndefined();
  expect(studioViewShortcut({ shiftKey: true, code: 'Digit8', key: '*' })).toBeUndefined();
});
