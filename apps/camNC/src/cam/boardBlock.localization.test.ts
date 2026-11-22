import { afterEach, expect, it } from 'vitest';
import { i18n } from '@wbcnc/i18n';
import { cutFromEarlierDesign, layoutBlock } from './boardBlock';
import { friendly } from './plan/planNotes';
import type { JobBoard } from './useJobBoards';

afterEach(async () => {
  await i18n.changeLanguage('en');
});

it('keeps physical-sheet protection independent of the explanation language', async () => {
  const board = { board: { cut: { sourceKey: 'old' } } } as JobBoard;
  await i18n.changeLanguage('fr');
  expect(cutFromEarlierDesign(board, 'new')).toBe(true);
  expect(cutFromEarlierDesign(board, 'old')).toBe(false);
  expect(cutFromEarlierDesign(board, undefined)).toBe(false);
  expect(layoutBlock(board, { bit: 6, missing: [], sourceKey: 'new' })).toContain('ancienne conception');
  await i18n.changeLanguage('en');
  expect(cutFromEarlierDesign(board, 'new')).toBe(true);
  expect(layoutBlock(board, { bit: 6, missing: [], sourceKey: 'new' })).toContain('earlier design');
});

it('recognizes raw CAM warning tokens before localizing their explanation', async () => {
  await i18n.changeLanguage('fr');
  expect(friendly('pocket: no tool fits')).toContain('plus étroit que la fraise');
  expect(friendly('pocket: no tool fits')).not.toContain('no tool fits');
});
