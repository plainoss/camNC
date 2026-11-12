import type { CadDocument } from '@wbcnc/cad';
import { createPlateDocument, updateDimension } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { acquireCadKeyboard, isCadEditorActive } from './keyboardOwnership';
import {
  acceptCadSession,
  acknowledgeCadSession,
  amendCadSession,
  cadCommandCheckpoint,
  cadSession,
  commitCadSession,
  endCadSession,
  markCadSession,
  redoCadSession,
  replaceCadSession,
  restoreCadSession,
  undoCadSession,
} from './session';

describe('CAD editing sessions', () => {
  it('keeps source IDs and undo across a route remount, while a new edit clears redo', () => {
    const document = createPlateDocument();
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    const session = cadSession(document);
    commitCadSession(session, updateDimension(document, width.id, 160));
    expect(cadSession(document)).toBe(session);
    const undone = undoCadSession(session);
    expect(undone.parts[0]!.id).toBe(document.parts[0]!.id);
    expect(undone.parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 120 });
    expect(redoCadSession(session).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 160 });
    undoCadSession(session);
    commitCadSession(session, updateDimension(session.document, width.id, 140));
    expect(session.future).toHaveLength(0);
    expect(session.entry).toEqual(document);
    endCadSession(document.id);
    expect(cadSession(document)).not.toBe(session);
  });

  it('restores the document and both history stacks on cancel, so the cancelled edit is neither undone nor redone', () => {
    const document = createPlateDocument();
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    const widthOf = (d: CadDocument) => d.parts[0]!.sketch.constraints.find(c => c.id === width.id);
    const session = cadSession(document);
    commitCadSession(session, updateDimension(document, width.id, 130));
    commitCadSession(session, updateDimension(session.document, width.id, 150));
    undoCadSession(session);
    // A dialog opens on 130 with 150 waiting to be redone, and previews two values before Cancel.
    const mark = markCadSession(session);
    commitCadSession(session, updateDimension(session.document, width.id, 170));
    commitCadSession(session, updateDimension(session.document, width.id, 190));
    const revision = session.document.revision;
    const restored = restoreCadSession(session, mark);
    expect(widthOf(restored)).toMatchObject({ value: 130 });
    expect(restored.revision).toBe(revision + 1);
    expect(session.past).toHaveLength(1);
    expect(session.future).toHaveLength(1);
    expect(widthOf(redoCadSession(session))).toMatchObject({ value: 150 });
    expect(widthOf(undoCadSession(session))).toMatchObject({ value: 130 });
    expect(widthOf(undoCadSession(session))).toMatchObject({ value: 120 });
    expect(session.past).toHaveLength(0);
    expect(session.future.map(d => widthOf(d))).toEqual([expect.objectContaining({ value: 150 }), expect.objectContaining({ value: 130 })]);
    // The mark keeps its own stacks: later undo and redo didn't change what it restores.
    expect(mark.past).toHaveLength(1);
    expect(() => restoreCadSession(session, { ...mark, document: { ...mark.document, id: 'other' } })).toThrow();
    endCadSession(document.id);
  });

  it('releases keyboard ownership once per mounted owner, including overlapping mounts', () => {
    const releaseA = acquireCadKeyboard(),
      releaseB = acquireCadKeyboard();
    expect(isCadEditorActive()).toBe(true);
    releaseA();
    releaseA();
    expect(isCadEditorActive()).toBe(true);
    releaseB();
    expect(isCadEditorActive()).toBe(false);
  });

  it('amends the current creation value while retaining a single undo and redo command', () => {
    const document = createPlateDocument();
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    const session = cadSession(document);
    commitCadSession(session, updateDimension(document, width.id, 160));
    const checkpoint = cadCommandCheckpoint(session);
    const amended = amendCadSession(session, updateDimension(session.document, width.id, 180), checkpoint);
    expect(amended?.parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 180 });
    expect(session.past).toHaveLength(1);
    expect(undoCadSession(session).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 120 });
    expect(redoCadSession(session).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 180 });
    endCadSession(document.id);
  });

  it('rejects an amendment after an unrelated command even when the undo stack length is unchanged', () => {
    const document = createPlateDocument();
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    const session = cadSession(document);
    commitCadSession(session, updateDimension(document, width.id, 160));
    const checkpoint = cadCommandCheckpoint(session);
    undoCadSession(session);
    commitCadSession(session, updateDimension(session.document, width.id, 140));
    const current = structuredClone(session.document);
    expect(session.past).toHaveLength(checkpoint.pastLength);
    expect(amendCadSession(session, updateDimension(session.document, width.id, 180), checkpoint)).toBeNull();
    expect(session.document).toEqual(current);
    expect(amendCadSession(session, { ...current, id: 'other-document' }, cadCommandCheckpoint(session))).toBeNull();
    endCadSession(document.id);
  });

  it('retains Undo across Finish and reentry while Cancel starts from the accepted design', () => {
    const document = createPlateDocument(),
      session = cadSession(document);
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    commitCadSession(session, updateDimension(document, width.id, 160));
    const accepted = structuredClone(session.document),
      past = structuredClone(session.past);
    acceptCadSession(session, accepted);
    expect(session.past).toEqual(past);
    expect(session.entry).toEqual(accepted);
    expect(cadSession(accepted)).toBe(session);
    expect(undoCadSession(session).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 120 });
    expect(session.entry).toEqual(accepted);
    expect(redoCadSession(session).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 160 });
    expect(session.entry).toEqual(accepted);
    endCadSession(document.id);
  });

  it('adopts canonical solved coordinates on reentry without changing source IDs or adding an undo step', () => {
    const document = createPlateDocument(),
      session = cadSession(document);
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    commitCadSession(session, updateDimension(document, width.id, 160));
    acceptCadSession(session, session.document);
    const canonical = structuredClone(session.document);
    const corner = canonical.parts[0]!.sketch.entities.find(e => e.type === 'point' && !e.fixed)!;
    if (corner.type !== 'point') throw Error();
    corner.x += 1e-8;
    // The route acknowledges the canonical document returned by durable acceptance.
    acknowledgeCadSession(session, canonical);
    expect(cadSession(canonical).document).toEqual(canonical);
    expect(session.entry).toEqual(canonical);
    expect(session.past).toHaveLength(1);
    expect(undoCadSession(session).parts[0]!.sketch.entities.map(e => e.id)).toEqual(document.parts[0]!.sketch.entities.map(e => e.id));
    const redone = redoCadSession(session);
    expect(redone.parts[0]!.sketch).toEqual(canonical.parts[0]!.sketch);
    endCadSession(document.id);
  });

  it('preserves redo when Finish accepts an undone design and clones the accepted baseline', () => {
    const document = createPlateDocument(),
      session = cadSession(document);
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    commitCadSession(session, updateDimension(document, width.id, 160));
    undoCadSession(session);
    const accepted = structuredClone(session.document);
    acceptCadSession(session, accepted);
    const reopened = cadSession(accepted);
    expect(reopened.future).toHaveLength(1);
    expect(redoCadSession(reopened).parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 160 });
    accepted.name = 'Changed outside the history';
    expect(session.entry.name).toBe(document.name);
    expect(session.entry.parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 120 });
    endCadSession(document.id);
  });

  it('rejects cross-document acceptance atomically', () => {
    const document = createPlateDocument(),
      session = cadSession(document),
      before = structuredClone(session);
    expect(() => acceptCadSession(session, createPlateDocument())).toThrow(/different CAD document/);
    expect(session).toEqual(before);
    endCadSession(document.id);
  });

  it('keeps a newer local edit if an acceptance caller stays mounted before later route reentry', () => {
    const document = createPlateDocument(),
      session = cadSession(document);
    const width = document.parts[0]!.sketch.constraints.find(c => c.label === 'Width')!;
    acceptCadSession(session, session.document);
    commitCadSession(session, updateDimension(session.document, width.id, 160));
    expect(cadSession(document).document.parts[0]!.sketch.constraints.find(c => c.id === width.id)).toMatchObject({ value: 160 });
    expect(session.entry).toEqual(document);
    endCadSession(document.id);
  });
});

describe('leaving a face sketch', () => {
  const edited = (document: CadDocument, revision: number): CadDocument => ({ ...document, name: `v${revision}`, revision });

  it('keeps the saved revision, however many edits the face sketch made, so the next save still matches', () => {
    const start = createPlateDocument(),
      session = cadSession(start),
      saved = edited(start, start.revision + 3);
    replaceCadSession(session, saved, start);
    acknowledgeCadSession(session, saved);
    expect(session.document.revision).toBe(saved.revision);
    expect(cadSession(session.document).saved).toEqual(saved);
    expect(session.conflict).toBeUndefined();
    endCadSession(start.id);
  });

  it('makes the whole face sketch one undo step', () => {
    const start = createPlateDocument(),
      session = cadSession(start),
      before = session.past.length;
    replaceCadSession(session, edited(start, start.revision + 3), start);
    expect(session.past).toHaveLength(before + 1);
    expect(undoCadSession(session).name).toBe(start.name);
    endCadSession(start.id);
  });

  it('adds no second step for a sketch that was just added', () => {
    const start = createPlateDocument(),
      session = cadSession(start),
      before = session.past.length;
    replaceCadSession(session, edited(start, start.revision + 3), null);
    expect(session.past).toHaveLength(before);
    endCadSession(start.id);
  });
});
