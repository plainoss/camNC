import { readFile } from 'node:fs/promises';
import type { CadDocument, CadPart } from '@wbcnc/cad';
import type { CadWorkflow, WorkflowCheck, WorkflowContext, WorkflowValue } from './workflow';

const sourcePart = (document: CadDocument, name: string): CadPart => {
  const part = document.parts.find(part => part.name === name);
  if (!part) throw new Error(`Missing source part ${name}.`);
  return part;
};
const reportPart = ({ report }: WorkflowContext, name: string) => {
  const part = report.parts.find(part => part.name === name);
  if (!part) throw new Error(`Missing evaluated part ${name}.`);
  return part;
};
const check = (
  layer: WorkflowCheck['layer'],
  description: string,
  expected: WorkflowValue,
  actual: WorkflowCheck['actual'],
  tolerance?: number
): WorkflowCheck => ({
  layer,
  description,
  expected,
  actual,
  ...(tolerance !== undefined && { tolerance }),
});
const dimensions = (name: string, width: number, height: number, thickness: number) =>
  check(
    'geometry',
    `${name} follows its dimension expressions.`,
    [width, height, thickness],
    context => {
      const part = reportPart(context, name);
      return [...(part.outline?.size ?? []), part.thickness];
    },
    0.01
  );
const assemblyBox = (name: string, at: number[], size: number[]) =>
  check(
    'assembly',
    `${name} stays in the expected assembly frame.`,
    { at, size },
    context => {
      const part = context.report.assembly?.parts.find(part => part.name === name);
      return part ? { at: part.at, size: part.size } : null;
    },
    0.01
  );
const pieceNames = ({ report }: WorkflowContext): WorkflowValue =>
  report.parts.flatMap(part => (part.pieces ? [...part.pieces.names, ...part.pieces.mirrored] : [part.name])).sort();
const openings = ({ report }: WorkflowContext) => report.steps?.flatMap(step => (step.kind === 'partCut' ? step.cuts : [])) ?? [];
const variable = (document: CadDocument, name: string, expression: string) => {
  const existing = document.variables?.find(variable => variable.name === name);
  if (!existing) throw new Error(`Missing variable ${name}.`);
  // Keep the old coordinates until the solver sees this edited source, as a parameter edit does in the application.
  existing.expression = expression;
  document.revision++;
  return document;
};

/** A complete cabinet stays the regression while its individual failures can be reduced to diagnostic cases. */
export function cupboardWorkflow(): CadWorkflow {
  let originalIds: string[] = [];
  let originalMirrorId = '';
  const identities = () =>
    check(
      'source',
      'Parameter edits preserve source part and mirrored-copy identities.',
      true,
      ({ document }) =>
        document.parts.map(part => part.id).join('|') === originalIds.join('|') &&
        sourcePart(document, 'Side').copies?.[0]?.id === originalMirrorId
    );
  const shelfInstances = (added: number) =>
    check(
      'source',
      'Surviving shelf pattern instance IDs persist across the edit.',
      { retained: true, added, unique: true },
      ({ previousDocument, document }) => {
        const previous = new Set((sourcePart(previousDocument, 'Shelf').copies ?? []).map(copy => copy.id));
        const next = (sourcePart(document, 'Shelf').copies ?? []).map(copy => copy.id);
        const current = new Set(next);
        return {
          retained: [...previous].every(id => current.has(id)),
          added: [...current].filter(id => !previous.has(id)).length,
          unique: next.length === current.size,
        };
      }
    );
  const noCollisions = () =>
    check('assembly', 'Fitted parts do not occupy the same material.', 0, ({ report }) => report.assembly?.collisions.length ?? null);
  const bodyCount = (n: number) =>
    check('assembly', 'The assembly contains every expected physical part.', n, ({ report }) => report.assembly?.parts.length ?? null);
  const sideCuts = (n: number) =>
    check('geometry', 'The side retains every pin pocket and enabled housing cut.', n, context => reportPart(context, 'Side').cuts.length);
  const common = (added = 0) => [identities(), noCollisions(), shelfInstances(added)];
  const allPieces = ['Side', 'Right side', 'Bottom', 'Top', 'Back', 'Shelf'];
  return {
    id: 'cupboard-regeneration',
    name: 'Cabinet with mirrored sides, repeated shelves and dependent rebates',
    async create() {
      const document = JSON.parse(await readFile(new URL('../../fixtures/designs/cupboard.json', import.meta.url), 'utf8')) as CadDocument;
      originalIds = document.parts.map(part => part.id);
      originalMirrorId = sourcePart(document, 'Side').copies![0]!.id;
      return document;
    },
    checkpoints: [
      {
        id: 'assembled',
        checks: [
          ...common(),
          bodyCount(6),
          dimensions('Side', 300, 720, 18),
          dimensions('Shelf', 562, 284, 18),
          sideCuts(37),
          assemblyBox('Right side', [582, 0, 0], [18, 300, 720]),
          check(
            'geometry',
            'Top, bottom and back each cut an 8 mm housing.',
            [8, 8, 8],
            context =>
              openings(context)
                .map(cut => cut.depth)
                .sort((a, b) => a - b),
            0.01
          ),
          check('cam', 'The cutting handoff keeps the mirrored side and all five source parts.', [...allPieces].sort(), pieceNames),
        ],
      },
      {
        id: 'resize-stock-and-width',
        edit(document) {
          return variable(variable(document, 'board', '21mm'), 'width', '760mm');
        },
        checks: [
          ...common(),
          bodyCount(6),
          dimensions('Side', 300, 720, 21),
          dimensions('Top', 734, 294, 21),
          dimensions('Back', 734, 720, 6),
          dimensions('Shelf', 716, 284, 21),
          assemblyBox('Right side', [739, 0, 0], [21, 300, 720]),
          assemblyBox('Top', [13, 0, 699], [734, 294, 21]),
          sideCuts(37),
        ],
      },
      {
        id: 'repeat-shelves',
        edit(document) {
          document.variables!.push({ id: 'workflow:shelves', name: 'shelves', expression: '3' });
          const shelf = sourcePart(document, 'Shelf');
          shelf.pattern = { id: 'workflow:shelf-pattern', axis: 'z', count: 3, countExpression: 'shelves', spacing: 120 };
          document.revision++;
          return document;
        },
        checks: [
          ...common(2),
          bodyCount(8),
          assemblyBox('Shelf 3', [22, 0, 503.5], [716, 284, 21]),
          check('cam', 'Every patterned shelf reaches the cutting handoff.', [...allPieces, 'Shelf 2', 'Shelf 3'].sort(), pieceNames),
        ],
      },
      {
        id: 'grow-shelf-count',
        edit(document) {
          return variable(document, 'shelves', '4');
        },
        checks: [
          ...common(1),
          bodyCount(9),
          assemblyBox('Shelf 4', [22, 0, 623.5], [716, 284, 21]),
          check(
            'cam',
            'A new pattern instance reaches the cutting handoff.',
            [...allPieces, 'Shelf 2', 'Shelf 3', 'Shelf 4'].sort(),
            pieceNames
          ),
        ],
      },
      {
        id: 'move-shelf-stack',
        edit(document) {
          const shelf = sourcePart(document, 'Shelf');
          shelf.drawnOn!.offsetExpression = 'board + margin + 4*pitch + pin/2';
          document.revision++;
          return document;
        },
        checks: [
          ...common(),
          bodyCount(9),
          dimensions('Shelf', 716, 284, 21),
          assemblyBox('Shelf', [22, 0, 231.5], [716, 284, 21]),
          assemblyBox('Shelf 4', [22, 0, 591.5], [716, 284, 21]),
        ],
      },
      {
        id: 'clearance',
        edit(document) {
          document.partCuts![0]!.clearance = 0.2;
          document.revision++;
          return document;
        },
        checks: [
          ...common(),
          bodyCount(9),
          sideCuts(37),
          check(
            'geometry',
            'A 0.2 mm clearance deepens all three housings.',
            [8.2, 8.2, 8.2],
            context =>
              openings(context)
                .map(cut => cut.depth)
                .sort((a, b) => a - b),
            0.01
          ),
        ],
      },
      {
        id: 'suppress-housings',
        edit(document) {
          document.partCuts![0]!.suppressed = true;
          document.revision++;
          return document;
        },
        expectedErrors: ['parts-collide'],
        checks: [
          identities(),
          shelfInstances(0),
          bodyCount(9),
          sideCuts(34),
          check(
            'assembly',
            'Only fitted panels intersect the sides when housings are suppressed.',
            ['Back / Right side', 'Back / Side', 'Bottom / Right side', 'Bottom / Side', 'Right side / Top', 'Side / Top'].sort(),
            ({ report }) => (report.assembly?.collisions ?? []).map(collision => [...collision.parts].sort().join(' / ')).sort()
          ),
          check('geometry', 'The disabled cut-parts step contributes no openings.', 0, context => openings(context).length),
        ],
      },
      {
        id: 'restore-and-reload',
        edit(document) {
          delete document.partCuts![0]!.suppressed;
          document.revision++;
          return document;
        },
        reload: true,
        checks: [
          ...common(),
          bodyCount(9),
          sideCuts(37),
          assemblyBox('Shelf 4', [22, 0, 591.5], [716, 284, 21]),
          check(
            'geometry',
            'Restoring the step recovers its clearance without resetting it.',
            [8.2, 8.2, 8.2],
            context =>
              openings(context)
                .map(cut => cut.depth)
                .sort((a, b) => a - b),
            0.01
          ),
          check('cam', 'Reload keeps every physical cutting piece.', [...allPieces, 'Shelf 2', 'Shelf 3', 'Shelf 4'].sort(), pieceNames),
        ],
      },
    ],
  };
}
