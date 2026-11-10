import { readFile } from 'node:fs/promises';
import {
  activeDesign,
  cadCopyName,
  cadPartReference,
  consumedTools,
  evaluatedPartCopy,
  isCadPart,
  setCadVariable,
  type CadDocument,
} from '@wbcnc/cad';
import { axisMaterial } from './axisMaterial';
import type { WorkflowCheck, WorkflowContext, WorkflowValue } from './workflow';
import type { RecipeBox } from './woodworkingExpected';

export const sourcePart = (document: CadDocument, name: string) => {
  const part = document.parts.find(p => p.name === name);
  if (!part) throw new Error(`Missing source part ${name}.`);
  return part;
};
export async function loadWoodworkingSource(name: string): Promise<CadDocument> {
  return JSON.parse(await readFile(new URL(`../../fixtures/designs/${name}.json`, import.meta.url), 'utf8'));
}
export function sourceVariable(document: CadDocument, name: string, expression: string): CadDocument {
  const existing = document.variables?.find(v => v.name === name);
  if (!existing) throw new Error(`Missing source variable ${name}.`);
  const next = setCadVariable(document, { id: existing.id, name, expression });
  if ('error' in next) throw new Error(next.error);
  return next.document;
}
export const check = (
  layer: WorkflowCheck['layer'],
  description: string,
  expected: WorkflowValue,
  actual: WorkflowCheck['actual'],
  tolerance?: number
): WorkflowCheck => ({ layer, description, expected, actual, ...(tolerance === undefined ? {} : { tolerance }) });

export function sourceOwners(document: CadDocument) {
  return Object.fromEntries(document.parts.map(p => [p.name, p.id]));
}
/** Authored dependencies, never solved coordinates or variable-dependent numeric caches. */
export function authoringSignature(document: CadDocument): string {
  return JSON.stringify(
    document.parts.map(part => ({
      id: part.id,
      name: part.name,
      sketch: part.sketch.id,
      entities: part.sketch.entities.map(e =>
        e.type === 'point' ? Object.fromEntries(Object.entries(e).filter(([key]) => !['x', 'y'].includes(key))) : e
      ),
      dimensions: part.sketch.constraints.map(c => {
        const definition = Object.fromEntries(
          Object.entries(c).filter(([key]) => !['value', 'expression', 'label', 'labelPlacement'].includes(key))
        );
        if (!('value' in c)) return definition;
        return { ...definition, ...(c.expression ? { expression: c.expression } : { value: c.value }) };
      }),
      thickness: part.thicknessExpression ?? part.thickness,
      on: part.drawnOn?.on ?? null,
      offset: part.drawnOn?.offsetExpression ?? part.drawnOn?.offset ?? null,
      inward: !!part.drawnOn?.inward,
      pattern: part.pattern
        ? {
            id: part.pattern.id,
            axis: part.pattern.axis,
            count: part.pattern.countExpression ?? part.pattern.count,
            spacing: part.pattern.spacingExpression ?? part.pattern.spacing,
          }
        : null,
    }))
  );
}
export const authoringCheck = (original: () => string) =>
  check(
    'source',
    'Authored dimension, plane, extrusion and pattern dependencies remain intact.',
    true,
    ({ sourceDocument }) => authoringSignature(sourceDocument) === original()
  );
export function identityChecks(
  owners: () => Record<string, string>,
  pattern?: { part: string; id: () => string; count: number }
): WorkflowCheck[] {
  return [
    check('source', 'Named source parts retain their original identity owner.', true, ({ document }) => {
      const before = owners(),
        current = sourceOwners(document);
      return (
        document.parts.length === Object.keys(before).length &&
        new Set(document.parts.map(p => p.name)).size === document.parts.length &&
        Object.keys(before).every(name => current[name] === before[name])
      );
    }),
    ...(pattern
      ? [
          check(
            'source',
            'Pattern copy slots retain exact identities and append only the declared new slots.',
            { samePattern: true, alignedSlots: true, copies: pattern.count - 1 },
            ({ document }) => {
              const part = sourcePart(document, pattern.part);
              return {
                samePattern: part.pattern?.id === pattern.id(),
                alignedSlots: (part.copies ?? []).every((copy, i) => copy.id === `${pattern.id()}:${i + 1}`),
                copies: part.copies?.length ?? 0,
              };
            }
          ),
        ]
      : []),
  ];
}

interface ExpectedMaterial {
  bodies: { name: string; bounds: RecipeBox; volume: number; components: number }[];
  materialProbes: { body: string; point: number[]; material: boolean }[];
  collisionPairs: string[][];
}
/** Actual measurements consume evaluator output; expected recipe math remains in a separate module. */
export function materialChecks(expected: ExpectedMaterial): WorkflowCheck[] {
  const cached = new WeakMap<CadDocument, Map<string, { id: string; material: ReturnType<typeof axisMaterial> }>>();
  const measurements = (context: WorkflowContext) => {
    const found = cached.get(context.document);
    if (found) return found;
    const active = activeDesign(context.document),
      consumed = consumedTools(active),
      bodies = new Map<string, { id: string; material: ReturnType<typeof axisMaterial> }>();
    for (const source of active.parts) {
      if (!isCadPart(source) || consumed.has(source.id)) continue;
      const evaluated = context.parts.find(p => p.partId === source.id);
      if (!evaluated) throw new Error(`Missing evaluated body ${source.name}.`);
      if (!source.placement) throw new Error(`Missing solved placement for ${source.name}.`);
      bodies.set(source.name, { id: source.id, material: axisMaterial(evaluated, source.placement) });
      for (const [i, copy] of (source.copies ?? []).entries()) {
        if (!copy.placement) throw new Error(`Missing solved placement for ${cadCopyName(source, i)}.`);
        bodies.set(cadCopyName(source, i), {
          id: cadPartReference(source.id, copy.id),
          material: axisMaterial(evaluatedPartCopy(evaluated, copy), copy.placement),
        });
      }
    }
    cached.set(context.document, bodies);
    return bodies;
  };
  const wantedNames = expected.bodies.map(b => b.name).sort();
  return [
    check('solver', 'Every sketch stays fully constrained with no unexpected warnings.', [], ({ report }) =>
      report.warnings.map(w => w.code).sort()
    ),
    check('assembly', 'Every physical body is present once by semantic name.', wantedNames, ({ report }) =>
      (report.assembly?.parts ?? []).map(body => body.name).sort()
    ),
    ...expected.bodies.flatMap(body => [
      check(
        'assembly',
        `${body.name} occupies its independent intended world bounds.`,
        body.bounds,
        context => measurements(context).get(body.name)?.material.bounds ?? null,
        0.001
      ),
      check(
        'geometry',
        `${body.name} retains its independently specified occupied volume.`,
        body.volume,
        context => measurements(context).get(body.name)?.material.volume ?? null,
        0.01
      ),
      check(
        'geometry',
        `${body.name} retains one connected material body.`,
        body.components,
        context => measurements(context).get(body.name)?.material.components ?? null
      ),
    ]),
    check(
      'geometry',
      'Independent interior phase and clearance probes match occupied material.',
      expected.materialProbes.map(p => p.material),
      context =>
        expected.materialProbes.map(p => {
          const body = measurements(context).get(p.body);
          if (!body) throw new Error(`Probe body ${p.body} is missing.`);
          return body.material.containsWorld(p.point);
        })
    ),
    check(
      'assembly',
      'Only the declared semantic body pairs overlap.',
      expected.collisionPairs.map(pair => [...pair].sort().join(' / ')).sort(),
      ({ report }) => (report.assembly?.collisions ?? []).map(pair => [...pair.parts].sort().join(' / ')).sort()
    ),
    check('cam', 'Every intended physical piece reaches the cutting handoff.', wantedNames, ({ report }) =>
      report.parts.flatMap(p => (p.pieces ? [...p.pieces.names, ...p.pieces.mirrored] : [p.name])).sort()
    ),
  ];
}
