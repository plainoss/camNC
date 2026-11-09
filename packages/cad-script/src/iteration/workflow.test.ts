import { createHash } from 'node:crypto';
import { createPlateDocument, type CadDocument } from '@wbcnc/cad';
import { describe, expect, it } from 'vitest';
import { cupboardWorkflow } from './cupboard';
import { runCadWorkflow, type CadWorkflow } from './workflow';

const diagnostic = (): CadWorkflow => ({
  id: 'diagnostic',
  name: 'Small plate diagnostic',
  create: () => createPlateDocument({ width: 100, height: 60, thickness: 18 }),
  checkpoints: [
    {
      id: 'plate',
      checks: [
        {
          layer: 'geometry',
          description: 'The plate has the specified dimensions.',
          expected: [100, 60],
          actual: ({ report }) => report.parts[0]!.outline!.size,
        },
      ],
    },
  ],
});

describe('workflow checkpoints', () => {
  it('regenerates a complete cabinet through variables, pattern growth, placement, clearance, suppression and reload', async () => {
    const result = await runCadWorkflow(cupboardWorkflow());
    expect(result.firstFailure).toBeUndefined();
    expect(result.status).toBe('passed');
    expect(result.scope).toBe('complete');
    expect(result.checkpoints.map(checkpoint => checkpoint.id)).toEqual([
      'assembled',
      'resize-stock-and-width',
      'repeat-shelves',
      'grow-shelf-count',
      'move-shelf-stack',
      'clearance',
      'suppress-housings',
      'restore-and-reload',
    ]);
    for (const checkpoint of result.checkpoints) {
      expect(checkpoint.status).toBe('passed');
      expect(checkpoint.checks.every(check => check.passed)).toBe(true);
      expect(JSON.parse(checkpoint.sourceText)).toEqual(checkpoint.sourceDocument);
      expect(createHash('sha256').update(checkpoint.sourceText).digest('hex')).toBe(checkpoint.sourceSha256);
      expect(new Set(checkpoint.bodies.map(body => body.id)).size).toBe(checkpoint.bodies.length);
      expect(checkpoint.bodies.every(body => body.frame === 'part-local')).toBe(true);
      expect(checkpoint.solvedCoordinates).toBe('candidate-derived');
    }
    const resized = result.checkpoints[1]!;
    // A shared parameter edit must be available to an independent solver before camNC updates its cached numbers.
    expect(resized.sourceDocument.parts.find(part => part.name === 'Top')!.thickness).toBe(18);
    expect(resized.solvedDocument!.parts.find(part => part.name === 'Top')!.thickness).toBe(21);
    expect(resized.sourceDocument.variables!.find(variable => variable.name === 'board')!.expression).toBe('21mm');
    const repeated = result.checkpoints[2]!;
    expect(repeated.sourceDocument.parts.find(part => part.name === 'Shelf')!.copies).toBeUndefined();
    expect(repeated.solvedDocument!.parts.find(part => part.name === 'Shelf')!.copies).toHaveLength(2);
    const initialMirror = result.checkpoints[0]!.bodies.find(body => body.mirrored)!;
    expect(result.checkpoints.at(-1)!.bodies.find(body => body.mirrored)!.id).toBe(initialMirror.id);
    expect(result.checkpoints.at(-1)!.checks.find(check => check.layer === 'persistence')?.passed).toBe(true);
  }, 20_000);

  it('retains the original multi-part workflow and stops at its first divergent edit', async () => {
    const workflow = cupboardWorkflow();
    const edit = workflow.checkpoints[1]!.edit!;
    workflow.checkpoints[1]!.edit = async document => {
      const next = await edit(document);
      next.variables!.find(variable => variable.name === 'width')!.expression = '700mm';
      return next;
    };
    const result = await runCadWorkflow(workflow);
    expect(result.status).toBe('failed');
    expect(result.checkpoints.map(checkpoint => checkpoint.id)).toEqual(['assembled', 'resize-stock-and-width']);
    expect(result.firstFailure).toMatchObject({
      checkpoint: 'resize-stock-and-width',
      layer: 'geometry',
      expected: [734, 294, 21],
      actual: [674, 294, 21],
    });
  });

  it('detects replacement of surviving shelf pattern identities even when the geometry and piece names stay correct', async () => {
    const workflow = cupboardWorkflow();
    const grow = workflow.checkpoints.find(checkpoint => checkpoint.id === 'grow-shelf-count')!;
    const edit = grow.edit!;
    grow.edit = async document => {
      const next = await edit(document);
      next.parts.find(part => part.name === 'Shelf')!.pattern!.id = 'replacement-pattern';
      return next;
    };
    const result = await runCadWorkflow(workflow);
    expect(result.status).toBe('failed');
    expect(result.firstFailure).toEqual({
      checkpoint: 'grow-shelf-count',
      layer: 'source',
      message: 'Surviving shelf pattern instance IDs persist across the edit.',
      expected: { retained: true, added: 1, unique: true },
      actual: { retained: false, added: 3, unique: true },
    });
    expect(
      result.checkpoints
        .at(-1)!
        .bodies.filter(
          body => body.sourcePartId === result.checkpoints.at(-1)!.solvedDocument!.parts.find(part => part.name === 'Shelf')!.id
        )
    ).toHaveLength(4);
  });

  it('detects unexpected shelf intersections after suppressing the housings', async () => {
    const workflow = cupboardWorkflow();
    const suppress = workflow.checkpoints.find(checkpoint => checkpoint.id === 'suppress-housings')!;
    const edit = suppress.edit!;
    suppress.edit = async document => {
      const next = await edit(document);
      next.parts.find(part => part.name === 'Side')!.moved = { by: [2, 0, 0] };
      return next;
    };
    const result = await runCadWorkflow(workflow);
    expect(result.status).toBe('failed');
    expect(result.firstFailure).toMatchObject({
      checkpoint: 'suppress-housings',
      layer: 'assembly',
      message: 'Only fitted panels intersect the sides when housings are suppressed.',
    });
    expect(result.firstFailure!.actual).toContain('Shelf / Side');
  });

  it('preserves an unsupported checkpoint as incomplete work instead of a passing empty test', async () => {
    const workflow = diagnostic();
    workflow.checkpoints[0]!.unsupported = 'The diagnostic backend cannot represent this operation.';
    const result = await runCadWorkflow(workflow);
    expect(result.status).toBe('unsupported');
    expect(result.checkpoints[0]!.solvedDocument).toBeUndefined();
    expect(result.firstFailure).toMatchObject({
      checkpoint: 'plate',
      layer: 'source',
      message: 'The diagnostic backend cannot represent this operation.',
    });
  });

  it('exports only physical bodies when tool parts and their copies are consumed or the cut is suppressed', async () => {
    const target = createPlateDocument({ width: 100, height: 60, thickness: 18 });
    target.parts[0]!.name = 'Target';
    target.parts[0]!.placement = { position: [0, 0, 0], rotation: [0, 0, 0, 1] };
    const tool = createPlateDocument({ width: 20, height: 20, thickness: 18 }).parts[0]!;
    tool.name = 'Tool';
    tool.placement = { position: [40, 20, 10], rotation: [0, 0, 0, 1] };
    tool.copies = [{ id: 'tool-copy', placement: { position: [70, 20, 10], rotation: [0, 0, 0, 1] } }];
    target.parts.push(tool);
    target.partCuts = [{ id: 'tool-cut', tools: [tool.id], targets: [target.parts[0]!.id], clearance: 0 }];
    const checks = [
      {
        layer: 'cam' as const,
        description: 'The remaining target reaches the cutting handoff.',
        expected: true,
        actual: ({ report }: { report: { parts: { name: string }[] } }) => report.parts.some(part => part.name === 'Target'),
      },
    ];
    const result = await runCadWorkflow({
      id: 'consumed-tools',
      name: 'Consumed tool identities',
      create: () => structuredClone(target),
      checkpoints: [
        { id: 'kept', checks },
        {
          id: 'consumed',
          edit(document) {
            document.partCuts![0]!.consumeTools = true;
            return document;
          },
          checks,
        },
        {
          id: 'suppressed',
          edit(document) {
            document.partCuts![0]!.suppressed = true;
            return document;
          },
          expectedErrors: ['parts-collide'],
          checks,
        },
      ],
    });
    expect(result.firstFailure).toBeUndefined();
    expect(result.checkpoints.map(checkpoint => checkpoint.bodies.map(body => body.name))).toEqual([
      ['Target', 'Tool', 'Tool 2'],
      ['Target'],
      ['Target', 'Tool', 'Tool 2'],
    ]);
    expect(result.checkpoints[0]!.bodies.find(body => body.copyId)?.id).toBe(result.checkpoints[2]!.bodies.find(body => body.copyId)?.id);
  });

  it('preserves copy names when an earlier copy is suppressed', async () => {
    const document = createPlateDocument();
    document.parts[0]!.copies = [{ id: 'first', suppressed: true }, { id: 'second' }];
    const workflow = diagnostic();
    workflow.create = () => document;
    workflow.checkpoints[0]!.checks = [
      { layer: 'source', description: 'The source part is retained.', expected: true, actual: () => true },
    ];
    const result = await runCadWorkflow(workflow);
    expect(result.checkpoints[0]!.bodies.map(body => body.name)).toEqual(['Plate', 'Plate 3']);
  });

  it('returns a structured source failure when the workflow cannot create its starting document', async () => {
    const workflow = diagnostic();
    workflow.create = (): CadDocument => {
      throw new Error('Saved design is unavailable');
    };
    const result = await runCadWorkflow(workflow);
    expect(result.status).toBe('failed');
    expect(result.checkpoints).toEqual([]);
    expect(result.firstFailure).toEqual({ checkpoint: 'create', layer: 'source', message: 'Saved design is unavailable' });
  });

  it('reports a broken observable in the layer that owns it', async () => {
    const workflow = diagnostic();
    workflow.checkpoints[0]!.checks = [
      {
        layer: 'cam',
        description: 'Read the cutting handoff.',
        expected: true,
        actual() {
          throw new Error('Missing physical piece');
        },
      },
    ];
    const result = await runCadWorkflow(workflow);
    expect(result.firstFailure).toMatchObject({ checkpoint: 'plate', layer: 'cam', message: 'Missing physical piece' });
  });

  it('does not let a supported checkpoint pass without observable expectations', async () => {
    const workflow = diagnostic();
    workflow.checkpoints[0]!.checks = [];
    const result = await runCadWorkflow(workflow);
    expect(result.firstFailure).toMatchObject({ checkpoint: 'plate', layer: 'source' });
  });

  it('runs only through the requested checkpoint without declaring later work complete', async () => {
    const result = await runCadWorkflow(cupboardWorkflow(), { through: 'resize-stock-and-width' });
    expect(result.status).toBe('passed');
    expect(result.scope).toBe('prefix');
    expect(result.checkpoints.map(checkpoint => checkpoint.id)).toEqual(['assembled', 'resize-stock-and-width']);
  });

  it('refuses unknown or ambiguous checkpoint selection', async () => {
    const workflow = diagnostic();
    await expect(runCadWorkflow(workflow, { through: 'missing' })).rejects.toThrow('Unknown checkpoint');
    workflow.checkpoints.push(workflow.checkpoints[0]!);
    await expect(runCadWorkflow(workflow)).rejects.toThrow('unique');
  });
});
