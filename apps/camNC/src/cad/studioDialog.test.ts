import { createPlateDocument, setPartPattern } from '@wbcnc/cad';
import { expect, it } from 'vitest';
import { dialogCommand, editedStepId, featureDialog, picksParts, previewOwner, sameDialogShown, type StudioDialog } from './studioDialog';

const document = createPlateDocument();
const partId = document.parts[0]!.id;
const before = { document, past: [], future: [] };
const dialogs: StudioDialog[] = [
  { kind: 'extrude', partId, before },
  { kind: 'hole', partId, before },
  { kind: 'pattern', partId, before },
  { kind: 'transform', partId },
  { kind: 'mirror', partId },
  { kind: 'fillet' },
  { kind: 'plane' },
  { kind: 'variable' },
  { kind: 'partCut' },
];
const kinds = (accepted: (dialog: StudioDialog) => boolean) => dialogs.filter(accepted).map(dialog => dialog.kind);

it('names the toolbar command of every dialog', () => {
  expect(dialogs.map(dialog => dialogCommand[dialog.kind])).toEqual([
    'extrude',
    'hole',
    'pattern',
    'transform',
    'mirror',
    'fillet',
    'plane',
    'variable',
    'cutParts',
  ]);
});

it('narrows to the dialogs that commit as they are edited, as the same object', () => {
  expect(kinds(dialog => featureDialog(dialog) === dialog)).toEqual(['extrude', 'hole', 'pattern']);
  expect(kinds(dialog => featureDialog(dialog) === null)).toEqual(['transform', 'mirror', 'fillet', 'plane', 'variable', 'partCut']);
  expect(featureDialog(null)).toBeNull();
});

it('gives part clicks to the dialogs with a part field', () => {
  expect(kinds(picksParts)).toEqual(['pattern', 'transform', 'mirror', 'partCut']);
  expect(picksParts(null)).toBe(false);
});

it('owns a view candidate with the dialog itself, except for Extrude and Hole which commit live', () => {
  expect(kinds(dialog => previewOwner(dialog) === dialog)).toEqual([
    'pattern',
    'transform',
    'mirror',
    'fillet',
    'plane',
    'variable',
    'partCut',
  ]);
  expect(kinds(dialog => previewOwner(dialog) === null)).toEqual(['extrude', 'hole']);
  expect(previewOwner(null)).toBeNull();
});

it('finds the step a dialog edits', () => {
  expect(editedStepId(document, { kind: 'extrude', partId, before })).toBe(`${partId}:extrude`);
  expect(editedStepId(document, { kind: 'hole', partId, before })).toBe(`${partId}:extrude`);
  const patterned = setPartPattern(document, partId, { axis: 'x', count: 3, spacing: 100 });
  const patternId = patterned.parts[0]!.pattern!.id;
  expect(patternId).toBeTruthy();
  expect(editedStepId(patterned, { kind: 'pattern', partId, before })).toBe(patternId);
  expect(editedStepId(document, { kind: 'partCut', id: 'cut-1' })).toBe('cut-1');
  expect(editedStepId(document, { kind: 'transform', partId, copyId: 'copy-1' })).toBe('copy-1');
  expect(editedStepId(document, { kind: 'transform', partId, copyId: 'copy-1', move: true })).toBe('copy-1');
  expect(editedStepId(document, { kind: 'transform', partId, move: true })).toBe(`${partId}:move`);
  expect(editedStepId(document, { kind: 'mirror', partId, copyId: 'mirror-1' })).toBe('mirror-1');
});

it('has no edited step for a dialog adding one, nor for Fillet, Plane and Variable', () => {
  expect(editedStepId(document, null)).toBeNull();
  expect(editedStepId(document, { kind: 'pattern', partId, before })).toBeNull();
  expect(editedStepId(document, { kind: 'partCut' })).toBeNull();
  expect(editedStepId(document, { kind: 'transform', partId })).toBeNull();
  expect(editedStepId(document, { kind: 'mirror', partId })).toBeNull();
  expect(editedStepId(document, { kind: 'fillet', partId, filletId: 'round' })).toBeNull();
  expect(editedStepId(document, { kind: 'plane', id: 'plane-1' })).toBeNull();
  expect(editedStepId(document, { kind: 'variable', id: 'width' })).toBeNull();
});

it('keeps a dialog opened again in place only when it shows the same step, and a pattern never', () => {
  // Each opening is a new object, as the toolbar and feature list make them.
  expect(dialogs.map(dialog => sameDialogShown(dialog, { ...dialog }))).toEqual([true, true, false, true, true, true, true, true, true]);
  expect(sameDialogShown(null, { kind: 'plane' })).toBe(false);
  expect(sameDialogShown({ kind: 'plane' }, { kind: 'plane', id: 'p1' })).toBe(false);
  expect(sameDialogShown({ kind: 'plane', id: 'p1' }, { kind: 'variable', id: 'p1' })).toBe(false);
  expect(sameDialogShown({ kind: 'mirror', partId }, { kind: 'mirror', partId, copyId: 'c1' })).toBe(false);
  expect(sameDialogShown({ kind: 'transform', partId }, { kind: 'transform', partId, copyId: 'c1' })).toBe(false);
});
