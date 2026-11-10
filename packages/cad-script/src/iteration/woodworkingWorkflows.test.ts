import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { dividedTrayWorkflow } from './dividedTray';
import { fittedJointsWorkflow } from './fittedJoints';
import { missingDividerToolWorkflow, underconstrainedJointWorkflow } from './woodworkingDiagnostics';
import { runCadWorkflow, type CadWorkflow } from './workflow';

describe('complete woodworking edit workflows', () => {
  it.each([dividedTrayWorkflow, fittedJointsWorkflow])(
    'checks all eight cumulative states, exact sources and reload for %s',
    async factory => {
      const result = await runCadWorkflow(factory());
      expect(result.firstFailure).toBeUndefined();
      expect(result.status).toBe('passed');
      expect(result.scope).toBe('complete');
      expect(result.checkpoints).toHaveLength(8);
      for (const row of result.checkpoints) {
        expect(row.checks.every(check => check.passed)).toBe(true);
        expect(createHash('sha256').update(row.sourceText).digest('hex')).toBe(row.sourceSha256);
        expect(new Set(row.bodies.map(b => b.id)).size).toBe(row.bodies.length);
        expect(row.bodies.every(b => b.frame === 'part-local' && b.placementCoordinates === 'candidate-derived')).toBe(true);
      }
      expect(result.checkpoints.at(-1)!.checks.find(c => c.layer === 'persistence')?.passed).toBe(true);
    }
  );
  it('exports the real cumulative edit before solving instead of replaying static golden coordinates', async () => {
    const result = await runCadWorkflow(dividedTrayWorkflow(), { through: 'grow-divider-count' });
    const width = (doc: (typeof result.checkpoints)[0]['sourceDocument']) =>
      Math.max(...doc.parts[0]!.sketch.entities.filter(e => e.type === 'point').map(p => p.x));
    expect(width(result.checkpoints[1]!.sourceDocument)).toBe(360);
    expect(width(result.checkpoints[1]!.solvedDocument!)).toBeCloseTo(420);
    expect(result.checkpoints[2]!.sourceDocument.parts.at(-1)!.copies).toHaveLength(2);
    expect(result.checkpoints[2]!.solvedDocument!.parts.at(-1)!.copies).toHaveLength(3);
    expect(result.scope).toBe('prefix');
  });
  it('rejects a source owner swap and pattern identity churn despite unchanged physical counts', async () => {
    for (const mutation of ['owners', 'pattern']) {
      const workflow = dividedTrayWorkflow(),
        grow = workflow.checkpoints[2]!,
        edit = grow.edit!;
      grow.edit = async d => {
        const next = await edit(d);
        if (mutation === 'owners') {
          const left = next.parts.find(p => p.name === 'Left wall')!,
            right = next.parts.find(p => p.name === 'Right wall')!;
          [left.id, right.id] = [right.id, left.id];
        } else next.parts.find(p => p.name === 'Divider')!.pattern!.id = 'replacement-pattern';
        return next;
      };
      const result = await runCadWorkflow(workflow);
      expect(result.firstFailure).toMatchObject({ checkpoint: 'grow-divider-count', layer: 'source' });
    }
  });
  it('rejects a changed authored dependency even when its current evaluated geometry is equal', async () => {
    const workflow = dividedTrayWorkflow();
    workflow.checkpoints[0]!.edit = document => {
      const width = document.parts.find(p => p.name === 'Base')!.sketch.constraints.find(c => c.type === 'distanceX')!;
      if (width.type !== 'distanceX') throw new Error('Missing width dimension.');
      width.expression = 'width * board / 12mm';
      return document;
    };
    const result = await runCadWorkflow(workflow);
    expect(result.firstFailure).toMatchObject({
      checkpoint: 'assembled',
      layer: 'source',
      message: 'Authored dimension, plane, extrusion and pattern dependencies remain intact.',
    });
  });
  function corruptActual(
    workflow: CadWorkflow,
    checkpoint: string,
    change: (parts: Parameters<CadWorkflow['checkpoints'][0]['checks'][0]['actual']>[0]['parts']) => void
  ) {
    const check = workflow.checkpoints
        .find(c => c.id === checkpoint)!
        .checks.find(c => c.description.includes('independent intended world bounds'))!,
      actual = check.actual;
    check.actual = context => {
      change(context.parts);
      return actual(context);
    };
    return workflow;
  }
  it('detects a missing actual groove with correct source settings and unchanged body envelopes', async () => {
    const workflow = corruptActual(dividedTrayWorkflow(), 'assembled', parts => {
      parts.find(p => p.name === 'Base')!.cuts!.pop();
    });
    const result = await runCadWorkflow(workflow);
    expect(result.firstFailure).toMatchObject({ checkpoint: 'assembled', layer: 'geometry', expected: 1005696, actual: 1016064 });
  });
  it('detects an even-count phase reversal even when all occupied volumes and bounds stay equal', async () => {
    const workflow = corruptActual(fittedJointsWorkflow(), 'grow-finger-count', parts => {
      for (const part of parts.filter(p => ['Front', 'Side'].includes(p.name)))
        for (const cut of part.cuts ?? []) cut.outline = cut.outline.map(p => ({ ...p, y: 120 - p.y }));
    });
    const result = await runCadWorkflow(workflow);
    expect(result.firstFailure).toMatchObject({
      checkpoint: 'grow-finger-count',
      layer: 'geometry',
      message: 'Independent interior phase and clearance probes match occupied material.',
    });
    expect(
      result.checkpoints
        .at(-1)!
        .checks.filter(c => c.description.includes('occupied volume'))
        .every(c => c.passed)
    ).toBe(true);
  });
  it('keeps missing selected tools and the original unconstrained joint as explicit incomplete diagnostics', async () => {
    const missing = await runCadWorkflow(missingDividerToolWorkflow());
    expect(missing.status).toBe('unsupported');
    expect(missing.firstFailure).toMatchObject({ checkpoint: 'missing-selected-tool', layer: 'source' });
    const before = missing.checkpoints.at(-2)!,
      after = missing.checkpoints.at(-1)!;
    expect(after.sourceDocument.partCuts![0]!.tools).toEqual(before.solvedDocument!.partCuts![0]!.tools);
    expect(after.solvedDocument).toBeUndefined();
    const original = await runCadWorkflow(underconstrainedJointWorkflow());
    expect(original.status).toBe('unsupported');
    expect(original.checkpoints[0]!.sourceDocument.parts.map(p => p.name)).toEqual(['Part 2', 'Part 3']);
    expect(original.checkpoints[0]!.solvedDocument).toBeUndefined();
  });
});
