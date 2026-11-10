import {
  addCircle,
  addCopyFaceSketch,
  addPartCut,
  cadSketchRegions,
  createCadDocument,
  createCadPart,
  createPlateDocument,
  evaluateCadDocument,
  removeCadFeature,
  setCutDepth,
  setPartPattern,
  updateDimension,
} from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { applyCadProposal, cadProposal, cadProposalRefusal, compareCadProposal } from './proposal';
import { cadSession, commitCadSession, endCadSession, redoCadSession, undoCadSession } from './session';

describe('outside design proposals', () => {
  it('keeps the invisible new-design starter out of the visible change list', () => {
    const base = createCadDocument();
    base.parts.push(createCadPart());
    const candidate = structuredClone(base);
    candidate.parts[0]!.extrude = false;
    expect(compareCadProposal(cadProposal(base, candidate)).removed).toEqual([]);
  });
  it('preserves untouched source and geometry, and applies as one undo step', () => {
    const start = createPlateDocument();
    const session = cadSession(start);
    const candidate = { ...structuredClone(start), name: 'Renamed design' };
    const proposal = cadProposal(start, candidate);
    const originalGeometry = evaluateCadDocument(start).parts;
    applyCadProposal(session, proposal);
    expect(session.past).toHaveLength(1);
    expect(session.document.parts).toEqual(start.parts);
    expect(evaluateCadDocument(session.document).parts).toEqual(originalGeometry);
    expect(undoCadSession(session).name).toBe(start.name);
    expect(redoCadSession(session).name).toBe('Renamed design');
    endCadSession(start.id);
  });

  it('refuses an intervening edit, even after undo, without touching history', () => {
    const start = createPlateDocument();
    const session = cadSession(start);
    const proposal = cadProposal(start, { ...start, name: 'Candidate' });
    const width = start.parts[0]!.sketch.constraints.find(constraint => constraint.label === 'Width')!;
    commitCadSession(session, updateDimension(start, width.id, 200));
    expect(cadProposalRefusal(session, proposal)).toMatch(/changed/);
    undoCadSession(session);
    const previous = structuredClone(session);
    expect(() => applyCadProposal(session, proposal)).toThrow(/changed/);
    expect(session).toEqual(previous);
    endCadSession(start.id);
  });

  it('clones candidates, refuses other designs and rejects malformed source atomically', () => {
    const start = createPlateDocument();
    const candidate = structuredClone(start);
    const proposal = cadProposal(start, candidate);
    candidate.parts[0]!.name = 'Mutated outside';
    expect(proposal.document.parts[0]!.name).toBe(start.parts[0]!.name);
    expect(() => cadProposal(start, createPlateDocument())).toThrow(/open design/);
    const session = cadSession(start);
    proposal.document.parts[0]!.thickness = Number.NaN;
    expect(() => applyCadProposal(session, proposal)).toThrow();
    expect(session.past).toHaveLength(0);
    expect(session.document).toEqual(start);
    endCadSession(start.id);
  });

  it('reports additions, removals and changes using real step IDs', () => {
    const start = createPlateDocument();
    const candidate = structuredClone(start);
    candidate.parts[0]!.thickness += 3;
    const comparison = compareCadProposal(cadProposal(start, candidate));
    expect(comparison.changed).toContainEqual(expect.objectContaining({ id: `${start.parts[0]!.id}:extrude` }));
    expect(comparison.removed).toEqual([]);
    expect(comparison.added).toEqual([]);
    expect(compareCadProposal(cadProposal(start, { ...candidate, parts: [] })).removed).toHaveLength(2);
  });

  it('warns when an otherwise valid candidate loses its housing openings', () => {
    const start = createPlateDocument();
    const tool = createPlateDocument({ width: 20, height: 20 }).parts[0]!;
    tool.name = 'Shelf';
    tool.placement = { position: [20, 20, 10], rotation: [0, 0, 0, 1] };
    start.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    start.parts.push(tool);
    const joint = addPartCut(start, [tool.id], [start.parts[0]!.id], { value: 0 }).document;
    const candidate = structuredClone(joint);
    candidate.parts[1]!.placement!.position[2] = 18;
    const comparison = compareCadProposal(cadProposal(joint, candidate));
    expect(comparison.errors).toEqual([]);
    expect(comparison.costs).toContainEqual(expect.stringMatching(/1 housing or joint opening\(s\) lost/));
    expect(comparison.changed).toContainEqual(expect.objectContaining({ id: `${tool.id}:extrude` }));
  });

  it('reports a lost cut on one copy even when the family has no cuts', () => {
    let base = createPlateDocument();
    const partId = base.parts[0]!.id;
    base = setPartPattern(base, partId, { axis: 'z', count: 3, spacing: 50 });
    const copyId = base.parts[0]!.copies![0]!.id;
    const added = addCopyFaceSketch(base, partId, copyId, 'top');
    base = added.document;
    const face = base.parts[0]!.features!.find(feature => feature.type === 'sketch' && feature.sketch.id === added.sketchId)!;
    if (face.type !== 'sketch') throw new Error('Missing sketch');
    face.sketch = addCircle(face.sketch, { x: 40, y: 40, radius: 5, positioned: true, dimensioned: true });
    const region = cadSketchRegions(base.parts[0]!, face.sketch.id).find(region =>
      region.points.every(point => point.x > 30 && point.x < 50 && point.y > 30 && point.y < 50)
    )!;
    base = setCutDepth(base, partId, face.sketch.id, region.id, 'through');
    expect(evaluateCadDocument(base).diagnostics.filter(issue => issue.severity === 'error')).toEqual([]);
    const cutId = base.parts[0]!.features!.at(-1)!.id;
    const candidate = removeCadFeature(base, partId, cutId);
    const comparison = compareCadProposal(cadProposal(base, candidate));
    expect(comparison.errors).toEqual([]);
    expect(comparison.costs).toContainEqual(expect.stringContaining(`copy ${copyId}: cut ${cutId}`));
  });

  it('discloses a replaced joint even when the number of openings stays the same', () => {
    const start = createPlateDocument();
    const tool = createPlateDocument({ width: 20, height: 20 }).parts[0]!;
    tool.name = 'Old shelf';
    tool.placement = { position: [20, 20, 10], rotation: [0, 0, 0, 1] };
    start.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    start.parts.push(tool);
    const base = addPartCut(start, [tool.id], [start.parts[0]!.id], { value: 0 }).document;
    const candidate = structuredClone(base);
    const newId = crypto.randomUUID();
    candidate.parts[1] = {
      ...candidate.parts[1]!,
      id: newId,
      name: 'New shelf',
      placement: { position: [60, 20, 10], rotation: [0, 0, 0, 1] },
    };
    candidate.partCuts![0]!.tools = [newId];
    const comparison = compareCadProposal(cadProposal(base, candidate));
    expect(comparison.errors).toEqual([]);
    expect(comparison.costs).toContainEqual(expect.stringMatching(/1 housing or joint opening\(s\) lost/));
  });
});
